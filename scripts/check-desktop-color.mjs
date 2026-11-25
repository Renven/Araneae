import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/assets/three.module.js';
import {desktopStrings} from '../dist/desktop-i18n.js';
import {createOrganicAppearance} from '../dist/organic.js';

const PRESET_IDS = [
  'black-widow', 'redknee', 'peacock', 'wandering', 'funnel-web',
  'wolf', 'golden-orb', 'goliath', 'huntsman', 'crab',
];

test('color palette and all 10 spider preset labels are localized in English and Chinese', () => {
  const en = desktopStrings('en');
  const zh = desktopStrings('zh-CN');
  for (const key of [
    'color', 'colorDefault', 'resetColor', 'colorPaletteLabel', 'customColor',
    'spiderPresets', 'spiderPresetsLabel',
    'presetBlackWidow', 'presetRedknee', 'presetPeacock', 'presetWandering',
    'presetFunnelWeb', 'presetWolf', 'presetGoldenOrb', 'presetGoliath',
    'presetHuntsman', 'presetCrab',
  ]) {
    assert(en[key] && en[key].length > 0, `missing en.${key}`);
    assert(zh[key] && zh[key].length > 0, `missing zh.${key}`);
  }
});

test('custom hex tinting, all 10 spider presets, and exact reset restore original albedo', () => {
  const scene = new THREE.Scene();
  const body = new THREE.Group();
  const appearance = createOrganicAppearance(scene, body, []);
  const origAlbedo = new Uint8Array(appearance.bodyMaterials[0].map.image.data);
  const origThorax = appearance.bodyMaterials[0].color.getHexString();
  const origAbdomen = appearance.bodyMaterials[1].color.getHexString();

  appearance.setAppearance('#c83e37', null);
  assert.equal(appearance.appearanceKey, 'color:#c83e37');
  assert.notEqual(appearance.bodyMaterials[0].color.getHexString(), origThorax);

  for (const id of PRESET_IDS) {
    appearance.setAppearance(null, id);
    assert.equal(appearance.appearanceKey, `preset:${id}`);
  }

  appearance.setAppearance(null, 'peacock');
  assert.notEqual(
    appearance.bodyMaterials[0].color.getHexString(),
    appearance.bodyMaterials[1].color.getHexString(),
  );

  appearance.setAppearance(null, null);
  assert.equal(appearance.appearanceKey, 'default');
  assert.equal(appearance.bodyMaterials[0].color.getHexString(), origThorax);
  assert.equal(appearance.bodyMaterials[1].color.getHexString(), origAbdomen);
  assert.deepEqual(appearance.bodyMaterials[0].map.image.data, origAlbedo);
});
