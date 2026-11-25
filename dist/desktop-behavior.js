import {Vector3} from './assets/three.module.js';
import {DesktopNavigator, chooseFleeTarget, nearestScreen, clampPoint, contains, distance} from './desktop-routing.js';

// Desktop routing supplies destinations; the v18 patrol and motion controller
// retain ownership of observation, manual commands and the entire skid sequence.
export class DesktopBehavior {
  constructor(spider, screens, wholeScreen, project, unproject, desktop, allowCrossScreen = true) {
    // A single-screen navigator cannot generate cross-screen patrol or follow routes.
    const allowedScreens = allowCrossScreen ? screens : [screens[nearestScreen(screens, project(spider.position))]];
    Object.assign(this, {spider, screens: allowedScreens, wholeScreen, project, unproject, desktop, allowCrossScreen});
    this.navigator = new DesktopNavigator(allowedScreens, wholeScreen);
    this.pointer = null;
    this.routing = false;
    this.manualActive = false;
    this.manualSource = null;
  }

  get preciseArrival() {
    return this.manualActive && this.navigator.points.length === 1;
  }

  allowsPoint(point) {
    return this.allowCrossScreen || contains(this.screens[0].frame, point);
  }

  area(point) {
    const screen = this.screens[nearestScreen(this.screens, point)];
    return this.wholeScreen ? screen.frame : screen.workArea;
  }

  boundedPoint(x, y) {
    const point = {x: x + this.desktop.x, y: y + this.desktop.y};
    return this.unproject(clampPoint(this.area(point), point, 110 * this.spider.state.size));
  }

  chooseGoal(kind) {
    const {spider, navigator} = this;
    const point = this.project(spider.position);
    if (kind === 'short') {
      const direction = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0),
        spider.motion.heading + (spider.patrol.random() - .5) * 1.8);
      const probe = spider.position.clone().addScaledVector(direction,
        (65 + spider.patrol.random() * 90) * spider.state.size);
      const target = clampPoint(this.area(point), this.project(probe), 110 * spider.state.size);
      navigator.navigate(point, target);
    } else {
      navigator.chooseRoam(point, spider.state.size);
    }
    this.routing = true;
    return this.unproject(navigator.points[0] ?? navigator.target ?? point);
  }

  relocate(point) {
    if (!this.allowsPoint(point)) return;
    this.spider.cancelManual();
    const target = clampPoint(this.area(point), point, 110 * this.spider.state.size);
    this.routing = this.navigator.navigate(this.project(this.spider.position), target);
    this.spider.patrol.beginTravel('long');
    this.spider.motion.wake();
    const goal = this.navigator.points[0];
    if (goal) this.spider.goal.copy(this.unproject(goal));
  }

  avoid(pointer) {
    if ((this.manualActive && this.manualSource === 'user')
      || this.spider.sprinting
      || this.spider.motion?.arriving) return false;
    if (!this.allowsPoint(pointer)) return false;
    const position = this.project(this.spider.position);
    const target = chooseFleeTarget(this.screens, position, pointer, this.spider.state.size, this.wholeScreen);
    if (!target) return false;
    const world = this.unproject(target);
    if (!world || !this.manualCommand(world, 'avoid')) return false;
    this.spider.patrol.beginTravel('long');
    this.spider.motion.wake();
    const next = this.navigator.points[0];
    this.spider.goal.copy(next ? this.unproject(next) : world);
    return true;
  }

  cancelManual() {
    this.manualActive = false;
    this.manualSource = null;
    this.manualTarget = null;
    this.routing = false;
    this.navigator.points = [];
    this.navigator.target = null;
  }

  manualCommand(destination, source = 'user') {
    if (!this.allowsPoint(this.project(destination))) return false;
    if (!this.navigator.navigate(this.project(this.spider.position), this.project(destination))) return false;
    const motion = this.spider.motion;
    if (motion.skid && destination.distanceTo(motion.skid.goal) > 30 * this.spider.state.size / 1.5) {
      motion.skid = null;
      motion.setPhase('charge');
    }
    this.manualTarget = destination.clone();
    this.manualActive = true;
    this.manualSource = source;
    this.routing = true;
    return true;
  }

  updateGoal({autonomous, manual}) {
    const {spider, navigator} = this;
    if (manual) {
      if (!this.manualActive) return null;
      if (spider.motion.arriving) return spider.motion.skid.goal;
      const point = this.project(spider.position);
      const reach = Math.max(16, 32 * spider.state.size);
      while (navigator.points.length > 1 && distance(point, navigator.points[0]) < reach) navigator.points.shift();
      const target = navigator.points[0];
      const tolerance = (spider.sprinting ? 2 : 30) * spider.state.size / 1.5;
      if (navigator.points.length <= 1 && spider.velocity.length() < 1
        && (spider.motion.isAtGoal(this.manualTarget, spider.state.size)
          || spider.position.distanceTo(this.manualTarget) <= tolerance)) {
        this.manualActive = false;
        this.manualSource = null;
        this.routing = false;
      }
      return target ? this.unproject(target) : this.manualTarget;
    }
    if (spider.state.mode === 'observe') return null;
    const point = this.project(spider.position);
    if (spider.state.mode === 'follow' && this.pointer && !this.allowsPoint(this.pointer)) {
      // Ignore a pointer on another display instead of chasing its nearest edge.
      navigator.points = [];
      navigator.target = null;
      return spider.position;
    }
    if (spider.motion.arriving) {
      if (spider.state.mode === 'follow') {
        const goal = spider.motion.skid.goal;
        const target = this.pointer && clampPoint(this.area(this.pointer), this.pointer, 110 * spider.state.size);
        if (target && distance(target, this.project(goal)) > 70) {
          const next = navigator.step(point, 'follow', this.pointer, spider.state.size);
          return next ? this.unproject(next) : goal;
        }
        // The original follow handler has no browser pointer in passthrough
        // mode. Retain the arrival goal until recovery completes.
        return goal;
      }
      return null;
    }
    if (spider.state.mode === 'follow') {
      this.routing = true;
      const target = navigator.step(point, 'follow', this.pointer, spider.state.size);
      return target ? this.unproject(target) : null;
    }
    if (!autonomous || !this.routing || spider.patrol.observing) return null;
    const reach = Math.max(16, 32 * spider.state.size);
    // Retain the final target until v18 has stopped, observed, and requested a
    // new travel leg. Intermediate seam points are navigation only.
    while (navigator.points.length > 1 && distance(point, navigator.points[0]) < reach) {
      navigator.points.shift();
    }
    return navigator.points[0] ? this.unproject(navigator.points[0]) : null;
  }

  skidRoom(goal, velocity, size) {
    if (velocity.lengthSq() < 1) return 0;
    // Do not skid at an intermediate screen seam, where a straight overrun
    // could enter an invisible notch in a staggered display arrangement.
    if (this.routing && this.navigator.points.length > 1) return 0;
    const target = this.project(goal);
    const next = this.project(goal.clone().add(velocity.clone().normalize()));
    const area = this.area(target), margin = Math.min(84 * size, Math.min(area.width, area.height) * .22);
    const dx = next.x - target.x, dy = next.y - target.y;
    let limit = Infinity;
    if (Math.abs(dx) > 1e-8) limit = Math.min(limit,
      (dx > 0 ? area.x + area.width - margin - target.x : area.x + margin - target.x) / dx);
    if (Math.abs(dy) > 1e-8) limit = Math.min(limit,
      (dy > 0 ? area.y + area.height - margin - target.y : area.y + margin - target.y) / dy);
    // Uprighting can translate the body a little farther after the slide.
    return Math.max(0, limit - 28 * size);
  }
}
