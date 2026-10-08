// Over-the-shoulder walking camera (D57): on foot, the camera sits BOOM m behind the walker and a little to the
// right at about head height, and the walker is drawn (the crowd's figure, instance 0). The boom shortens until the
// street surface is under the camera, so it does not end inside a building. V toggles first / third person on foot,
// as it does at the helm.
const BOOM = 2.0, RIGHT = 0.45, HEIGHT = 1.7;

export class PlayerView {

	constructor() {

		this.third = true;
		this.phase = 0;
		this.figure = null;

	}

	update( app, dt, ground ) {

		const pl = app.player;
		if ( pl.mode === 'walk' && ! app.freeCam && app.input.hit( 'KeyV' ) ) this.third = ! this.third;
		this.figure = null;
		if ( ! this.third || app.freeCam || pl.mode !== 'walk' ) return;
		const p = pl.position;
		const speed = Math.hypot( pl.velocity.x, pl.velocity.z );
		this.phase += speed * dt * 1.75;
		const yaw = pl.yaw;
		const fx = - Math.sin( yaw ), fz = - Math.cos( yaw ), rx = - fz, rz = fx;
		this.figure = { x: p.x, y: p.y, z: p.z, yaw, phase: this.phase, walk: Math.min( 1, speed / 1.2 ) };
		// the boom, shortened where there is no street under the camera (a wall behind the walker)
		let boom = BOOM;
		for ( ; boom > 0.6; boom -= 0.2 ) {

			const x = p.x - fx * boom + rx * RIGHT, z = p.z - fz * boom + rz * RIGHT;
			if ( ! ground || ground.heightAt( x, z ) !== null || ground.heightAt( p.x, p.z ) === null ) break;

		}

		const cam = app.camera.position;
		cam.set( p.x - fx * boom + rx * RIGHT, p.y + HEIGHT + Math.max( 0, - pl.pitch ) * 0.6, p.z - fz * boom + rz * RIGHT );
		// the Player eases its own eye height; tell it the camera is still its own
		pl._camY = cam.y;

	}

}
