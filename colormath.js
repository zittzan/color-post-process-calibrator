(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ColorMath = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLOR_SPACE = 'linear';

  const sRGB_2_AP0 = [0.4397010, 0.3829780, 0.1773350,
                      0.0897923, 0.8134230, 0.0967616,
                      0.0175440, 0.1115440, 0.8707040];

  const AP0_2_AP1 = [1.4514393161, -0.2365107469, -0.2149285693,
                    -0.0765537734, 1.1762296998, -0.0996759264,
                     0.0083161484, -0.0060324498, 0.9977163014];

  const AP1_2_AP0 = [0.6954522414, 0.1406786965, 0.1638690622,
                     0.0447945634, 0.8596711185, 0.0955343182,
                    -0.0055258826, 0.0040252103, 1.0015006723];

  const AP1_2_XYZ = [0.6624541811, 0.1340042065, 0.1561876870,
                     0.2722287168, 0.6740817658, 0.0536895174,
                    -0.0055746495, 0.0040607335, 1.0103391003];

  const XYZ_2_AP1 = [1.6410233797, -0.3248032942, -0.2364246952,
                    -0.6636628587, 1.6153315917, 0.0167563477,
                     0.0117218943, -0.0082844420, 0.9883948585];

  const D60_2_D65_CAT = [0.98722400, -0.00611327, 0.0159533,
                        -0.00759836, 1.00186000, 0.0053302,
                         0.00307257, -0.00509595, 1.0816800];

  const XYZ_2_REC709 = [3.2409699419, -1.5373831776, -0.4986107603,
                       -0.9692436363, 1.8759675015, 0.0415550574,
                        0.0556300797, -0.2039769589, 1.0569715142];

  const AP1_RGB2Y = [0.2722287168, 0.6740817658, 0.0536895174];
  const Rec709_Luma = [0.2126729, 0.7151522, 0.0721750];
  const ACEScc_MIDGRAY = 0.4135884;

  const LOGC = {
    a: 5.555556,
    b: 0.047996,
    c: 0.244161,
    d: 0.386036
  };

  const GLOW_GAIN = 0.05;
  const GLOW_MID = 0.08;
  const RED_SCALE = 0.82;
  const RED_PIVOT = 0.03;
  const RED_HUE = 0;
  const RED_WIDTH = 135;
  const RRT_SAT_FACTOR = 0.96;
  const ODT_SAT_FACTOR = 0.93;
  const DIM_SURROUND_GAMMA = 0.9811;

  const EPS = 1e-10;

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function clamp01(x) {
    return clamp(x, 0, 1);
  }

  function vec3(v) {
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }

  function map3(a, fn) {
    return [fn(a[0], 0), fn(a[1], 1), fn(a[2], 2)];
  }

  function add3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function mul3(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  }

  function scale3(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
  }

  function max3(a, s) {
    return [Math.max(a[0], s), Math.max(a[1], s), Math.max(a[2], s)];
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function mat3MulVec3(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }

  function lerp3(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function sceneToLinearChannel(x) {
    if (COLOR_SPACE === 'gamma') {
      return x;
    }
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function linearToSceneChannel(x) {
    if (COLOR_SPACE === 'gamma') {
      return x;
    }
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  function srgbToLinear(rgb) {
    return map3(rgb, sceneToLinearChannel);
  }

  function linearToSrgb(rgb) {
    return map3(rgb, linearToSceneChannel);
  }

  function hexToRgb01(hex) {
    if (typeof hex !== 'string') {
      return null;
    }
    let value = hex.trim();
    if (value.startsWith('#')) {
      value = value.slice(1);
    }
    if (value.length === 3) {
      if (!/^[0-9a-fA-F]{3}$/.test(value)) {
        return null;
      }
      value = value.split('').map((ch) => ch + ch).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
      return null;
    }
    return [
      parseInt(value.slice(0, 2), 16) / 255,
      parseInt(value.slice(2, 4), 16) / 255,
      parseInt(value.slice(4, 6), 16) / 255
    ];
  }

  function rgb01ToHex(rgb) {
    if (!rgb || rgb.length < 3) {
      return null;
    }
    const parts = [rgb[0], rgb[1], rgb[2]].map((x) => {
      if (!Number.isFinite(x)) {
        return null;
      }
      const n = Math.round(clamp01(x) * 255);
      return n.toString(16).toUpperCase().padStart(2, '0');
    });
    if (parts.some((part) => part === null)) {
      return null;
    }
    return `#${parts.join('')}`;
  }

  function ACES_to_ACEScc(x) {
    if (x <= 0) {
      return -0.35828683;
    }
    if (x < Math.pow(2, -15)) {
      return (Math.log2(Math.pow(2, -16) + x * 0.5) + 9.72) / 17.52;
    }
    return (Math.log2(x) + 9.72) / 17.52;
  }

  function ACEScc_to_ACES(y) {
    if (y < (9.72 - 15) / 17.52) {
      return (Math.pow(2, y * 17.52 - 9.72) - Math.pow(2, -16)) * 2;
    }
    if (y < (Math.log2(65504) + 9.72) / 17.52) {
      return Math.pow(2, y * 17.52 - 9.72);
    }
    return 65504;
  }

  function LinearToLogC(x) {
    return LOGC.c * Math.log10(Math.max(LOGC.a * x + LOGC.b, 0)) + LOGC.d;
  }

  function LogCToLinear(y) {
    return (Math.pow(10, (y - LOGC.d) / LOGC.c) - LOGC.b) / LOGC.a;
  }

  function applyContrastLog(rgb, contrastValue, acesMode) {
    const multiplier = contrastValue === null || contrastValue === undefined ? 1 : contrastValue / 100 + 1;
    if (acesMode) {
      const cc = map3(rgb, ACES_to_ACEScc);
      const adjusted = map3(cc, (x) => (x - ACEScc_MIDGRAY) * multiplier + ACEScc_MIDGRAY);
      return map3(adjusted, ACEScc_to_ACES);
    }

    const logc = map3(rgb, LinearToLogC);
    const adjusted = map3(logc, (x) => (x - ACEScc_MIDGRAY) * multiplier + ACEScc_MIDGRAY);
    return map3(adjusted, LogCToLinear);
  }

  function lum(rgb) {
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }

  function vector4OrDefault(value) {
    if (!value) {
      return { x: 1, y: 1, z: 1, w: 0 };
    }
    return {
      x: Number(value.x ?? value.r ?? 1),
      y: Number(value.y ?? value.g ?? 1),
      z: Number(value.z ?? value.b ?? 1),
      w: Number(value.w ?? value.a ?? 0)
    };
  }

  function colorFilterVector(value) {
    if (!value) {
      return [1, 1, 1];
    }
    return [
      Number(value.r ?? value.x ?? 1),
      Number(value.g ?? value.y ?? 1),
      Number(value.b ?? value.z ?? 1)
    ];
  }

  function scaleVector4(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s, w: v.w * s };
  }

  function ColorToLift(v) {
    const rgb = [v.x, v.y, v.z];
    const l = lum(rgb);
    return [v.x - l + v.w, v.y - l + v.w, v.z - l + v.w];
  }

  function ColorToInverseGamma(v) {
    const rgb = [v.x, v.y, v.z];
    const l = lum(rgb);
    return [
      1 / Math.max(v.x - l + v.w + 1, 1e-3),
      1 / Math.max(v.y - l + v.w + 1, 1e-3),
      1 / Math.max(v.z - l + v.w + 1, 1e-3)
    ];
  }

  function ColorToGain(v) {
    const rgb = [v.x, v.y, v.z];
    const l = lum(rgb);
    return [v.x - l + v.w + 1, v.y - l + v.w + 1, v.z - l + v.w + 1];
  }

  function prepareLiftGammaGain(profileParams) {
    const hasLgg = Boolean(profileParams.lift || profileParams.gamma || profileParams.gain);
    if (!hasLgg) {
      return null;
    }

    const lift = scaleVector4(vector4OrDefault(profileParams.lift), 0.15);
    const gamma = scaleVector4(vector4OrDefault(profileParams.gamma), 0.8);
    const gain = scaleVector4(vector4OrDefault(profileParams.gain), 0.8);
    return {
      lift: ColorToLift(lift),
      invgamma: ColorToInverseGamma(gamma),
      gain: ColorToGain(gain)
    };
  }

  function signedPow(x, p) {
    if (x === 0) {
      return 0;
    }
    return Math.sign(x) * Math.pow(Math.abs(x), p);
  }

  function applyLiftGammaGain(rgb, lgg) {
    if (!lgg) {
      return rgb;
    }
    const gained = add3(mul3(rgb, lgg.gain), lgg.lift);
    return [
      signedPow(gained[0], lgg.invgamma[0]),
      signedPow(gained[1], lgg.invgamma[1]),
      signedPow(gained[2], lgg.invgamma[2])
    ];
  }

  function applySaturation(rgb, saturationValue, weights) {
    const sat = saturationValue === null || saturationValue === undefined ? 1 : saturationValue / 100 + 1;
    const y = dot3(rgb, weights);
    return [
      y + sat * (rgb[0] - y),
      y + sat * (rgb[1] - y),
      y + sat * (rgb[2] - y)
    ];
  }

  function rgb_2_saturation(rgb) {
    const M = Math.max(rgb[0], rgb[1], rgb[2]);
    const m = Math.min(rgb[0], rgb[1], rgb[2]);
    return (Math.max(M, 1e-4) - Math.max(m, 1e-4)) / Math.max(M, 1e-2);
  }

  function rgb_2_yc(rgb) {
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    const chroma = Math.max(b * (b - g) + g * (g - r) + r * (r - b), 0);
    return (r + g + b + 1.75 * Math.sqrt(chroma)) / 3;
  }

  function sigmoid_shaper(x) {
    const t = Math.max(1 - Math.abs(x / 2), 0);
    return (1 + Math.sign(x) * (1 - t * t)) / 2;
  }

  function glow_fwd(yc, g, mid) {
    if (yc <= (2 / 3) * mid) {
      return g;
    }
    if (yc >= 2 * mid) {
      return 0;
    }
    return g * (mid / yc - 0.5);
  }

  function rgb_2_hue(rgb) {
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    if (r === g && g === b) {
      return 0;
    }
    const hue = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI;
    return hue < 0 ? hue + 360 : hue;
  }

  function center_hue(h, c) {
    let hue = h - c;
    while (hue <= -180) {
      hue += 360;
    }
    while (hue > 180) {
      hue -= 360;
    }
    return hue;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function xyzToXyY(xyz) {
    const sum = xyz[0] + xyz[1] + xyz[2];
    if (Math.abs(sum) < EPS) {
      return [0, 0, xyz[1]];
    }
    return [xyz[0] / sum, xyz[1] / sum, xyz[1]];
  }

  function xyYToXyz(xyY) {
    const x = xyY[0];
    const y = xyY[1];
    const Y = xyY[2];
    if (Math.abs(y) < EPS) {
      return [0, 0, 0];
    }
    return [x * Y / y, Y, (1 - x - y) * Y / y];
  }

  function darkSurroundToDimSurround(rgb) {
    const xyz = mat3MulVec3(AP1_2_XYZ, rgb);
    const xyY = xyzToXyY(xyz);
    xyY[2] = Math.pow(Math.max(xyY[2], 0), DIM_SURROUND_GAMMA);
    return mat3MulVec3(XYZ_2_AP1, xyYToXyz(xyY));
  }

  function acesFittedTonemap(acescg) {
    let aces = mat3MulVec3(AP1_2_AP0, acescg);

    const saturation = rgb_2_saturation(aces);
    const ycIn = rgb_2_yc(aces);
    const s = sigmoid_shaper((saturation - 0.4) / 0.2);
    const addedGlow = 1 + glow_fwd(ycIn, GLOW_GAIN * s, GLOW_MID);
    aces = scale3(aces, addedGlow);

    const hue = rgb_2_hue(aces);
    const centeredHue = center_hue(hue, RED_HUE);
    let hueWeight = smoothstep(0, 1, 1 - Math.abs(2 * centeredHue / RED_WIDTH));
    hueWeight *= hueWeight;
    aces[0] += hueWeight * saturation * (RED_PIVOT - aces[0]) * (1 - RED_SCALE);

    let rgb = max3(mat3MulVec3(AP0_2_AP1, aces), 0);
    const rrtLuma = dot3(rgb, AP1_RGB2Y);
    rgb = lerp3([rrtLuma, rrtLuma, rrtLuma], rgb, RRT_SAT_FACTOR);

    rgb = map3(rgb, (x) => {
      return x * (278.5085 * x + 10.7772) / (x * (293.6045 * x + 88.7122) + 80.6889);
    });

    rgb = darkSurroundToDimSurround(rgb);

    const odtLuma = dot3(rgb, AP1_RGB2Y);
    rgb = lerp3([odtLuma, odtLuma, odtLuma], rgb, ODT_SAT_FACTOR);

    const xyzD60 = mat3MulVec3(AP1_2_XYZ, rgb);
    const xyzD65 = mat3MulVec3(D60_2_D65_CAT, xyzD60);
    return mat3MulVec3(XYZ_2_REC709, xyzD65);
  }

  function solveLinear3(A, b) {
    const m = [
      [A[0][0], A[0][1], A[0][2], b[0]],
      [A[1][0], A[1][1], A[1][2], b[1]],
      [A[2][0], A[2][1], A[2][2], b[2]]
    ];

    for (let col = 0; col < 3; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < 3; row += 1) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
          pivot = row;
        }
      }
      if (Math.abs(m[pivot][col]) < 1e-12) {
        return null;
      }
      if (pivot !== col) {
        const tmp = m[col];
        m[col] = m[pivot];
        m[pivot] = tmp;
      }
      const div = m[col][col];
      for (let k = col; k < 4; k += 1) {
        m[col][k] /= div;
      }
      for (let row = 0; row < 3; row += 1) {
        if (row === col) {
          continue;
        }
        const factor = m[row][col];
        for (let k = col; k < 4; k += 1) {
          m[row][k] -= factor * m[col][k];
        }
      }
    }

    return [m[0][3], m[1][3], m[2][3]];
  }

  function gaussNewtonStep(J, residual) {
    const JTJ = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    const JTr = [0, 0, 0];
    const lambda = 1e-8;

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        JTr[col] += J[row][col] * residual[row];
        for (let k = 0; k < 3; k += 1) {
          JTJ[col][k] += J[row][col] * J[row][k];
        }
      }
    }
    for (let i = 0; i < 3; i += 1) {
      JTJ[i][i] += lambda;
    }

    return solveLinear3(JTJ, [-JTr[0], -JTr[1], -JTr[2]]);
  }

  function errorStats(forward, c, goal) {
    const out = forward(c);
    const residual = sub3(out, goal);
    return {
      out,
      residual,
      error2: dot3(residual, residual),
      maxResidual: Math.max(Math.abs(residual[0]), Math.abs(residual[1]), Math.abs(residual[2]))
    };
  }

  function buildPipeline(profileParams) {
    const params = Object.assign({
      lift: null,
      gamma: null,
      gain: null,
      saturation: null,
      postExposure: null,
      contrast: null,
      colorFilter: null,
      tonemapMode: 0
    }, profileParams || {});

    const acesMode = params.tonemapMode === 1;
    const lgg = prepareLiftGammaGain(params);
    const filter = colorFilterVector(params.colorFilter);

    function forward(rgb01) {
      let c = srgbToLinear(vec3(rgb01));

      if (params.postExposure !== null && params.postExposure !== undefined) {
        c = scale3(c, Math.pow(2, params.postExposure));
      }

      if (acesMode) {
        c = mat3MulVec3(sRGB_2_AP0, c);
        c = applyContrastLog(c, params.contrast, true);
        c = mat3MulVec3(AP0_2_AP1, c);
      } else {
        c = applyContrastLog(c, params.contrast, false);
      }

      if (params.colorFilter) {
        c = mul3(c, filter);
      }

      c = max3(c, 0);
      c = applyLiftGammaGain(c, lgg);
      c = applySaturation(c, params.saturation, acesMode ? AP1_RGB2Y : Rec709_Luma);

      if (acesMode) {
        c = acesFittedTonemap(c);
      }

      c = map3(c, clamp01);
      return map3(linearToSrgb(c), clamp01);
    }

    function solve(goalRgb01, hintRgb01) {
      const goal = vec3(goalRgb01);
      const starts = [goal, [0.5, 0.5, 0.5]];
      if (hintRgb01) {
        starts.splice(1, 0, vec3(hintRgb01));
      }

      let best = null;
      const convergence = 0.5 / 255;

      for (const start of starts) {
        let c = map3(start, clamp01);
        let stats = errorStats(forward, c, goal);

        for (let iter = 0; iter < 64; iter += 1) {
          if (stats.maxResidual < convergence) {
            break;
          }

          const h = 1e-3;
          const J = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
          ];

          for (let axis = 0; axis < 3; axis += 1) {
            const cp = c.slice();
            const cm = c.slice();
            cp[axis] += h;
            cm[axis] -= h;
            const fp = forward(cp);
            const fm = forward(cm);
            for (let row = 0; row < 3; row += 1) {
              J[row][axis] = (fp[row] - fm[row]) / (2 * h);
            }
          }

          const step = gaussNewtonStep(J, stats.residual);
          if (!step || step.some((v) => !Number.isFinite(v))) {
            break;
          }

          let accepted = false;
          const maxStep = Math.max(Math.abs(step[0]), Math.abs(step[1]), Math.abs(step[2]));
          let scale = maxStep > 0.25 ? 0.25 / maxStep : 1;
          for (let backtrack = 0; backtrack < 8; backtrack += 1) {
            const candidate = [
              clamp01(c[0] + step[0] * scale),
              clamp01(c[1] + step[1] * scale),
              clamp01(c[2] + step[2] * scale)
            ];
            const nextStats = errorStats(forward, candidate, goal);
            if (nextStats.error2 < stats.error2) {
              c = candidate;
              stats = nextStats;
              accepted = true;
              break;
            }
            scale *= 0.5;
          }

          if (!accepted) {
            break;
          }
        }

        if (!best || stats.error2 < best.error2) {
          best = {
            rgb01: c,
            error2: stats.error2,
            residual255: stats.maxResidual * 255
          };
        }
      }

      return {
        rgb01: best.rgb01,
        residual255: best.residual255
      };
    }

    return { forward, solve };
  }

  function solveCorrection(options) {
    if (!options || !options.target || !options.pipeline) {
      throw new Error('solveCorrection requires target and pipeline');
    }

    const target = vec3(options.target);
    const hasResidual = Boolean(options.input && options.output);
    let delta = null;
    let goal = target;

    if (hasResidual) {
      const predicted = options.pipeline.forward(options.input);
      delta = sub3(predicted, vec3(options.output));
      goal = add3(target, delta);
    }

    const solved = options.pipeline.solve(goal, hasResidual ? options.input : target);
    return {
      corrected: solved.rgb01,
      usedResidual: hasResidual,
      delta,
      residual255: solved.residual255
    };
  }

  return {
    COLOR_SPACE,
    hexToRgb01,
    rgb01ToHex,
    buildPipeline,
    solveCorrection
  };
}));
