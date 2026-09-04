// 카메라: 플레이어 추적 + 조준 방향 룩어헤드 + 흔들림.
// "무엇을 보여줄지"가 곧 게임 필이다.

import { clamp, damp } from '../core/math.js';
import { VIEW } from '../data/balance.js';

/** 화면 하단 HUD가 차지하는 높이(px) — 이 영역에는 전투가 오지 않게 한다 */
const HUD_SAFE_PX = 92;

/** 이보다 작게 줌아웃하면 적/예고가 너무 작아져 읽을 수 없다 */
const MIN_ZOOM = 0.72;

export function createCamera(world) {
  return {
    x: world.player.x, y: world.player.y,
    shakeX: 0, shakeY: 0,
    zoom: 1, targetZoom: 1,
    update(dt, aim, viewW, viewH) {
      const p = world.player;
      // 조준 방향으로 살짝 미리 본다 (공간 인지 향상)
      const lookX = clamp((aim.x - p.x) * 0.22, -110, 110);
      const lookY = clamp((aim.y - p.y) * 0.22, -80, 80);
      const tx = p.x + lookX;
      const ty = p.y + lookY;
      this.x = damp(this.x, tx, 7, dt);
      this.y = damp(this.y, ty, 7, dt);

      // 아레나가 화면을 항상 가득 채우도록 최소 줌을 계산한다 (검은 여백 방지)
      const a = world.arena;
      // 아레나 형태를 화면 비율에 맞췄으므로 cover 와 contain 이 거의 같다.
      // 그래도 여백이 생기지 않도록 cover 를 쓰되, 지나친 확대는 막는다.
      const cover = viewW && viewH ? Math.max(viewW / a.width, viewH / a.height) : 1;
      const base = Math.max(cover, MIN_ZOOM);
      // 보스전에서는 살짝 줌아웃 (패턴 전체가 보여야 한다)
      this.targetZoom = Math.max(base, base * (world.boss ? 1.0 : 1.06));
      this.zoom = damp(this.zoom, this.targetZoom, 3, dt);

      // 아레나 밖 빈 공간이 보이지 않도록 클램프.
      // 화면이 아레나보다 크면 중앙에 고정한다.
      if (viewW && viewH) {
        const halfW = viewW / (2 * this.zoom), halfH = viewH / (2 * this.zoom);
        // 하단 HUD가 전투를 가리지 않도록 아레나 아래쪽에 여유를 둔다
        const hudSafe = HUD_SAFE_PX / this.zoom;
        this.x = halfW * 2 >= a.width ? a.width / 2 : clamp(this.x, halfW, a.width - halfW);
        this.y = halfH * 2 >= a.height
          ? a.height / 2 + hudSafe * 0.5
          : clamp(this.y, halfH, a.height - halfH + hudSafe);
      }

      const s = world.shakeAmount;
      if (s > 0.05) {
        const a = Math.random() * Math.PI * 2;
        this.shakeX = Math.cos(a) * s;
        this.shakeY = Math.sin(a) * s;
      } else { this.shakeX = 0; this.shakeY = 0; }
    },
    /** 화면 좌표 → 월드 좌표 */
    toWorld(sx, sy, viewW, viewH) {
      const z = this.zoom;
      return {
        x: (sx - viewW / 2) / z + this.x,
        y: (sy - viewH / 2) / z + this.y,
      };
    },
    apply(ctx, viewW, viewH) {
      const z = this.zoom;
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(z, z);
      ctx.translate(-this.x + this.shakeX, -this.y + this.shakeY);
    },
  };
}
