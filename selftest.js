const ColorMath = require('./colormath');
const AssetParser = require('./asset-parser');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function maxAbsDiff(a, b) {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2])
  );
}

function profileFixture() {
  return `--- !u!114 &1
MonoBehaviour:
  m_Name: LiftGammaGain
  active: 1
  lift:
    m_OverrideState: 1
    m_Value: {x: 1, y: 1, z: 1, w: -0.03}
  gamma:
    m_OverrideState: 1
    m_Value: {x: 1, y: 1, z: 1, w: 0.06266775}
  gain:
    m_OverrideState: 1
    m_Value: {x: 1, y: 1, z: 1, w: 0.34482753}
--- !u!114 &2
MonoBehaviour:
  m_Name: ColorAdjustments
  active: 1
  postExposure:
    m_OverrideState: 0
    m_Value: 0
  contrast:
    m_OverrideState: 0
    m_Value: 0
  colorFilter:
    m_OverrideState: 0
    m_Value: {r: 1, g: 1, b: 1, a: 1}
  hueShift:
    m_OverrideState: 0
    m_Value: 0
  saturation:
    m_OverrideState: 1
    m_Value: 10.1
--- !u!114 &3
MonoBehaviour:
  m_Name: Tonemapping
  active: 1
  mode:
    m_OverrideState: 0
    m_Value: 1
--- !u!114 &4
MonoBehaviour:
  m_Name: ColorCurves
  active: 0
--- !u!114 &5
MonoBehaviour:
  m_Name: ChannelMixer
  active: 0
--- !u!114 &6
MonoBehaviour:
  m_Name: WhiteBalance
  active: 0
`;
}

function lcg(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function run() {
  const roundTripColors = ['#000000', '#FFFFFF', '#2B4786', '81c7e8', '#abc'];
  for (const color of roundTripColors) {
    const rgb = ColorMath.hexToRgb01(color);
    assert(rgb, `hexToRgb01 returned null for ${color}`);
    const hex = ColorMath.rgb01ToHex(rgb);
    assert(/^#[0-9A-F]{6}$/.test(hex), `rgb01ToHex format failed for ${color}`);
  }
  assert(ColorMath.rgb01ToHex(ColorMath.hexToRgb01('#abc')) === '#AABBCC', '#RGB expansion failed');
  assert(ColorMath.hexToRgb01('not-a-color') === null, 'invalid hex should return null');
  assert(ColorMath.hexToRgb01('#12') === null, 'short invalid hex should return null');

  const profileParams = {
    lift: { x: 1, y: 1, z: 1, w: -0.03 },
    gamma: { x: 1, y: 1, z: 1, w: 0.06266775 },
    gain: { x: 1, y: 1, z: 1, w: 0.34482753 },
    saturation: 10.1,
    postExposure: null,
    contrast: null,
    colorFilter: null,
    tonemapMode: 1
  };
  const pipeline = ColorMath.buildPipeline(profileParams);

  let prevR = -Infinity;
  for (let i = 0; i <= 32; i += 1) {
    const x = i / 32;
    const out = pipeline.forward([x, x, x]);
    assert(out[0] + 1e-8 >= prevR, `gray ramp R is not monotonic at ${i}`);
    prevR = out[0];
  }

  const black = pipeline.forward([0, 0, 0]);
  assert(black.every((x) => x < 0.02), `black forward expected < 0.02, got ${black}`);
  const white = pipeline.forward([1, 1, 1]);
  assert(white.every((x) => x >= 0.80 && x <= 0.95), `white forward expected 0.80..0.95, got ${white}`);

  const random = lcg(0x12345678);
  for (let i = 0; i < 20; i += 1) {
    const c = [random(), random(), random()];
    const g = pipeline.forward(c);
    const solved = pipeline.solve(g).rgb01;
    const roundTrip = pipeline.forward(solved);
    // ACES compression can be non-injective near gamut boundaries, so this checks F(solve(F(c))) against F(c).
    assert(maxAbsDiff(roundTrip, g) < 1 / 255, `solve forward round-trip failed at ${i}: ${maxAbsDiff(roundTrip, g)}`);
  }

  const offset = [0.02, -0.01, 0.015];
  const input = [0.32, 0.45, 0.62];
  const target = [0.48, 0.33, 0.71];
  const output = pipeline.forward(input).map((x, i) => x + offset[i]);
  const correction = ColorMath.solveCorrection({ target, input, output, pipeline });
  const measured = pipeline.forward(correction.corrected).map((x, i) => x + offset[i]);
  assert(maxAbsDiff(measured, target) < 1.5 / 255, `residual correction failed: ${maxAbsDiff(measured, target)}`);

  const parsed = AssetParser.parseVolumeProfile(profileFixture());
  assert(parsed.profileParams.lift.w === -0.03, 'lift w parse failed');
  assert(parsed.profileParams.gamma.w === 0.06266775, 'gamma w parse failed');
  assert(parsed.profileParams.gain.w === 0.34482753, 'gain w parse failed');
  assert(parsed.profileParams.saturation === 10.1, 'saturation parse failed');
  assert(parsed.profileParams.postExposure === null, 'postExposure override disabled should be null');
  assert(parsed.profileParams.contrast === null, 'contrast override disabled should be null');
  assert(parsed.profileParams.tonemapMode === 1, 'tonemap mode parse failed');
  assert(parsed.warnings.length === 0, `unexpected warnings: ${parsed.warnings.join(', ')}`);

  const warned = AssetParser.parseVolumeProfile(profileFixture().replace('m_Name: WhiteBalance\n  active: 0', 'm_Name: WhiteBalance\n  active: 1'));
  assert(warned.warnings.length >= 1, 'active WhiteBalance should warn');
}

try {
  run();
  console.log('ALL TESTS PASSED');
  process.exit(0);
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
