// test/render/bond-pop-anchor.test.js — bond layer pops (render/app.js 'layer' → fx.pop(…, { strip: true })) line up right of
// the bond strip's last disc (ctx.popAnchor: the strip is DOM over the canvas, and a long strip covered pops at the top
// centre); without a strip on screen (none yet, or collapsed — GitHub #142) and for the bounty coins, the top centre as
// before (render/fx/arrivals.js pop / popSpot).
// Run: node --test test/render/bond-pop-anchor.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FxSystem } from '../../public/js/render/fx.js';
import { popSpot } from '../../public/js/render/fx/arrivals.js';

const SIZE = { width: 1280, height: 720 };

test('popSpot: beside the strip\'s right end, the next pops further right (on screen); no anchor → the top centre, five abreast', () => {
  const a = { x: 600, y: 30 };
  assert.deepEqual(popSpot(SIZE, 1, a, () => 200), { x: 640, top: 40 }, 'the first just right of the strip, never above 40 px');
  assert.deepEqual(popSpot(SIZE, 2, { x: 600, y: 90 }, () => 200), { x: 724, top: 90 });
  assert.equal(popSpot(SIZE, 3, { x: 1250, y: 90 }, () => 200).x, SIZE.width - 60, 'kept on screen');
  assert.deepEqual(popSpot(SIZE, 1, null, () => 200), { x: 640 - 70, top: 200 }, 'the old spot');
  assert.deepEqual(popSpot(SIZE, 3, null, () => 150), { x: 640 + 70, top: 150 });
  assert.deepEqual(popSpot(SIZE, 1, { x: NaN, y: 1 }, () => 200), { x: 570, top: 200 }, 'a broken anchor falls back');
});

/** An FxSystem shell with fake Pixi containers: enough for pop(). */
function fxShell(popAnchor) {
  class Node {
    constructor() { this.anchor = { set() {} }; this.position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } }; this.scale = { set() {} }; this.children = []; }
    addChild(...c) { this.children.push(...c); }
    destroy() {}
  }
  const fx = Object.create(FxSystem.prototype);
  const screen = new Node();
  Object.assign(fx, {
    P: { Container: Node, Sprite: Node, BitmapText: Node, BLEND_MODES: { ADD: 1 } },
    tex: { glow: {} },
    pops: [],
    ctx: { screenSize: () => SIZE, fieldTop: () => 200, popAnchor, layers: { screen } },
  });
  return { fx, screen };
}

test('fx.pop: a bond layer pop ({ strip: true }) asks the strip anchor; a bounty pop never does', () => {
  let asked = 0;
  const { fx, screen } = fxShell(() => { asked++; return { x: 500, y: 60 }; });
  fx.pop(null, '+3', 0xffffff, 1, { strip: true });
  fx.pop(null, '+20', 0xffd700, 3);
  assert.equal(asked, 1);
  const [layer, coins] = screen.children;
  assert.deepEqual([layer.position.x, layer.position.y], [540, 60], 'right of the strip');
  assert.deepEqual([coins.position.x, coins.position.y], [640 + 70, 200], 'the top centre');
  // no strip shown (collapsed / empty): the top centre
  const shell = fxShell(() => null);
  shell.fx.pop(null, '+1', 0xffffff, 1, { strip: true });
  assert.deepEqual([shell.screen.children[0].position.x, shell.screen.children[0].position.y], [570, 200]);
});

test('render/app.js: the layer pop passes { strip: true } and popAnchor reads the match strip (.gm__bonds), whose hidden list has no box', () => {
  const src = readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8');
  assert.match(src, /fx\.pop\(tex, `\+\$\{n\}`, 0xffffff, layerPops\.size, \{ strip: true \}\)/);
  assert.match(src, /popAnchor: \(\) => \{[\s\S]*?\.gm__bonds \.bstrip:not\(\.bstrip--empty\)[\s\S]*?r\.width > 0 && r\.height > 0/);
});
