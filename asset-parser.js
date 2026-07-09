(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AssetParser = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUPPORTED = new Set(['LiftGammaGain', 'ColorAdjustments', 'Tonemapping']);

  function cleanString(value) {
    const trimmed = String(value || '').trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function parseNumber(value) {
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }

  function parseValue(raw) {
    const value = String(raw || '').trim();
    if (value.startsWith('{') && value.endsWith('}')) {
      const parsed = {};
      const re = /([xyzwrgba])\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
      let match;
      while ((match = re.exec(value)) !== null) {
        parsed[match[1]] = Number(match[2]);
      }
      if ('r' in parsed || 'g' in parsed || 'b' in parsed || 'a' in parsed) {
        return {
          r: parsed.r ?? 0,
          g: parsed.g ?? 0,
          b: parsed.b ?? 0,
          a: parsed.a ?? 0
        };
      }
      return {
        x: parsed.x ?? 0,
        y: parsed.y ?? 0,
        z: parsed.z ?? 0,
        w: parsed.w ?? 0
      };
    }

    const n = parseNumber(value);
    return n === null ? cleanString(value) : n;
  }

  function parseParams(lines) {
    const params = {};

    for (let i = 0; i < lines.length; i += 1) {
      const block = /^  ([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(lines[i]);
      if (!block) {
        continue;
      }

      const paramName = block[1];
      let overrideState = null;
      let value = null;

      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^  [A-Za-z_][A-Za-z0-9_]*:\s*$/.test(lines[j])) {
          break;
        }
        if (!/^ {4}/.test(lines[j]) && lines[j].trim() !== '') {
          break;
        }

        const overrideMatch = /^\s*m_OverrideState:\s*(\d+)/.exec(lines[j]);
        if (overrideMatch) {
          overrideState = Number(overrideMatch[1]);
          continue;
        }

        const valueMatch = /^\s*m_Value:\s*(.*)$/.exec(lines[j]);
        if (valueMatch) {
          value = parseValue(valueMatch[1]);
        }
      }

      if (overrideState !== null || value !== null) {
        params[paramName] = {
          override: overrideState === 1,
          overrideState: overrideState ?? 0,
          value
        };
      }
    }

    return params;
  }

  function scalarParam(component, key) {
    const param = component && component.params ? component.params[key] : null;
    return param && param.override ? param.value : null;
  }

  function vectorParam(component, key) {
    const param = component && component.params ? component.params[key] : null;
    return param && param.override ? param.value : null;
  }

  function modeName(mode) {
    if (mode === 1) {
      return 'ACES';
    }
    if (mode === 2) {
      return 'Neutral';
    }
    return 'None';
  }

  function parseDocument(docText) {
    const lines = docText.split(/\r?\n/);
    const nameLine = lines.find((line) => /^\s*m_Name:\s*/.test(line));
    const activeLine = lines.find((line) => /^\s*active:\s*/.test(line));
    const name = nameLine ? cleanString(nameLine.replace(/^\s*m_Name:\s*/, '')) : '';
    const active = activeLine ? Number(activeLine.replace(/^\s*active:\s*/, '').trim()) : 0;

    if (!name) {
      return null;
    }

    return {
      name,
      active: active === 1 ? 1 : 0,
      params: parseParams(lines)
    };
  }

  function parseVolumeProfile(text) {
    const docs = String(text || '').split(/^--- !u![^\n]*$/m);
    const components = docs.map(parseDocument).filter(Boolean);
    const warnings = [];
    const info = [];
    const profileParams = {
      lift: null,
      gamma: null,
      gain: null,
      saturation: null,
      postExposure: null,
      contrast: null,
      colorFilter: null,
      tonemapMode: 0
    };

    for (const component of components) {
      if (component.active === 1 && !SUPPORTED.has(component.name)) {
        warnings.push(`${component.name} は未対応のため理論値の精度が落ちる可能性があります（実測残差補正は有効です）`);
      }
    }

    const lgg = components.find((component) => component.name === 'LiftGammaGain' && component.active === 1);
    if (lgg) {
      profileParams.lift = vectorParam(lgg, 'lift');
      profileParams.gamma = vectorParam(lgg, 'gamma');
      profileParams.gain = vectorParam(lgg, 'gain');
    }

    const colorAdjustments = components.find((component) => component.name === 'ColorAdjustments' && component.active === 1);
    if (colorAdjustments) {
      profileParams.saturation = scalarParam(colorAdjustments, 'saturation');
      profileParams.postExposure = scalarParam(colorAdjustments, 'postExposure');
      profileParams.contrast = scalarParam(colorAdjustments, 'contrast');
      profileParams.colorFilter = vectorParam(colorAdjustments, 'colorFilter');

      const hueShift = colorAdjustments.params.hueShift;
      if (hueShift && hueShift.override && Number(hueShift.value) !== 0) {
        warnings.push('ColorAdjustments の hueShift は未対応のため理論値の精度が落ちる可能性があります（実測残差補正は有効です）');
      }
    }

    const tonemapping = components.find((component) => component.name === 'Tonemapping' && component.active === 1);
    if (tonemapping && tonemapping.params.mode) {
      const modeParam = tonemapping.params.mode;
      const mode = Number(modeParam.value);
      profileParams.tonemapMode = Number.isFinite(mode) ? mode : 0;
      if (!modeParam.override) {
        info.push(`Tonemapping mode は override 無効ですが m_Value (${modeName(profileParams.tonemapMode)}) を採用します`);
      }
      if (profileParams.tonemapMode === 2) {
        warnings.push('Tonemapping mode Neutral は未対応のため理論値の精度が落ちる可能性があります（実測残差補正は有効です）');
      }
    }

    return { components, profileParams, warnings, info };
  }

  return {
    parseVolumeProfile
  };
}));
