// 시뮬레이션 → 표현 계층(렌더/오디오/UI) 단방향 이벤트 버스.
// sim 은 "무슨 일이 일어났는지"만 알리고, 어떻게 보이/들릴지는 모른다.

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) for (let i = 0; i < list.length; i++) list[i](payload);
    const any = this.handlers.get('*');
    if (any) for (let i = 0; i < any.length; i++) any[i](type, payload);
  }
  clear() { this.handlers.clear(); }
}

/** sim 이 발생시키는 이벤트 이름 목록 (문서 겸 오타 방지) */
export const EV = {
  HIT: 'hit',                 // {x,y,dmg,crit,target,element,heavy}
  KILL: 'kill',               // {x,y,enemy,elite}
  PLAYER_HURT: 'playerHurt',  // {x,y,dmg}
  PLAYER_DEAD: 'playerDead',
  DASH: 'dash',               // {x,y,dir}
  ATTACK: 'attack',           // {x,y,dir,step,weapon,heavy}
  SPECIAL: 'special',         // {x,y,dir,weapon}
  PARRY: 'parry',
  STATUS: 'status',           // {x,y,kind}
  EXPLOSION: 'explosion',     // {x,y,radius,element}
  PROJECTILE_SPAWN: 'projSpawn',
  PROJECTILE_HIT: 'projHit',  // {x,y,element}
  PICKUP: 'pickup',           // {x,y,kind,amount}
  ROOM_CLEAR: 'roomClear',
  ROOM_ENTER: 'roomEnter',
  DOOR_OPEN: 'doorOpen',
  BOON_TAKEN: 'boonTaken',    // {boon,level}
  BOSS_PHASE: 'bossPhase',    // {phase}
  HEAL: 'heal',               // {x,y,amount}
  SHOCKWAVE: 'shockwave',     // {x,y,radius,color}
  TELEGRAPH: 'telegraph',     // {x,y,kind,...}
};
