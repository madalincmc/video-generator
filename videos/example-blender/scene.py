# 0-2s dusk over a mossy clearing, a closed mushroom in soft focus against the sky
# 2-4s cut close as it stretches, opens and starts to glow
# 4-6s the camera drifts up past fireflies while the light fills the clearing
import math

import bpy
import kit
from mathutils import Vector

config = dict(duration=6, fps=24, width=1920, height=1080, seed=4, samples=24)

CAP_WIDTH = 0.58
CAP_HEIGHT = 0.4
CAP_BASE = 1.24


def ground_height(x, y):
    return (x * x + y * y) * 0.004 + kit.fbm(x * 0.25, y * 0.25, octaves=5) * 0.3


def dome_point(theta):
    return Vector((CAP_WIDTH * math.sin(theta), 0, CAP_BASE + CAP_HEIGHT * math.cos(theta)))


def build_mushroom(r):
    stem_mat = kit.material('stem', '#d9c7a0', roughness=0.6, subsurface=0.4, variation=('#f0e3c4', 8), bump=(0.2, 45),
                            emission='#ffb86b', glow=0.0)
    stem = kit.loft('stem', [(0, 0, -0.02, 0.15), (0.02, 0, 0.42, 0.095), (-0.03, 0, 0.9, 0.078), (0, 0, 1.28, 0.1)], stem_mat,
                    segments=32, shape=lambda u, a: 1 + 0.04 * kit.fbm(math.cos(a) * 1.5, math.sin(a) * 1.5, u * 7))

    # The profile runs over the dome, around the rim and back under, so the cap has a real underside.
    cap_mat = kit.material('cap', '#a3302a', roughness=0.4, subsurface=0.08, coat=0.5, variation=('#df6a35', 4), bump=(0.15, 26),
                           emission='#ff6a26', glow=0.0)
    dome = [(CAP_WIDTH * math.sin(a), CAP_BASE + CAP_HEIGHT * math.cos(a)) for a in (0.01, 0.35, 0.7, 1.05, 1.35, 1.57)]
    underside = [(CAP_WIDTH * 0.96, CAP_BASE - 0.05), (CAP_WIDTH * 0.8, CAP_BASE - 0.03), (0.3, CAP_BASE + 0.02), (0.1, CAP_BASE + 0.05), (0.002, CAP_BASE + 0.05)]
    cap = kit.lathe('cap', dome + underside, cap_mat, segments=96, steps=70,
                    shape=lambda u, a: 1 + 0.015 * kit.fbm(math.cos(a) * 2, math.sin(a) * 2))

    gill_mat = kit.material('gills', '#c7a77c', roughness=0.8, subsurface=0.15, emission='#ffd08a', glow=0.0)
    verts = []
    faces = []
    for index in range(150):
        a = index / 150 * math.tau
        inner = 0.11 if index % 3 == 0 else r.uniform(0.2, 0.34)
        start = len(verts)
        for k in range(7):
            radius = inner + (CAP_WIDTH * 0.93 - inner) * k / 6
            top = CAP_BASE + 0.05 - 0.09 * (radius / CAP_WIDTH) ** 2
            drop = 0.035 * math.sin(math.pi * k / 6) + 0.004
            for z in (top + 0.01, top - drop):
                verts.append((math.cos(a) * radius, math.sin(a) * radius, z))
        faces += [(start + i * 2, start + i * 2 + 2, start + i * 2 + 3, start + i * 2 + 1) for i in range(6)]
    gills = kit.mesh('gills', verts, faces, gill_mat)

    # Warts sit on the dome, flattened along its surface, and are kept apart like the real thing.
    wart_mat = kit.material('warts', '#fff1d0', roughness=0.75, bump=(0.4, 90), emission='#fff0c0', glow=0.0)
    warts = []
    placed = []
    while len(warts) < 22:
        theta = r.uniform(0.12, 1.3)
        a = r.uniform(0, math.tau)
        p = dome_point(theta)
        p = Vector((p.x * math.cos(a), p.x * math.sin(a), p.z))
        size = r.uniform(0.03, 0.075)
        if any((p - q).length < (size + s) * 1.25 for q, s in placed):
            continue
        placed.append((p, size))
        n = Vector((math.sin(theta) / CAP_WIDTH * math.cos(a), math.sin(theta) / CAP_WIDTH * math.sin(a), math.cos(theta) / CAP_HEIGHT)).normalized()
        wart = kit.sphere(f'wart{len(warts)}', size, wart_mat, tuple(p), detail=4)
        kit.displace(wart, size * 0.25, 28 / max(size * 30, 0.5), seed=len(warts))
        wart.rotation_mode = 'QUATERNION'
        wart.rotation_quaternion = n.to_track_quat('Z', 'Y')
        wart.scale = (1, 1, 0.42)
        warts.append(wart)

    arm = kit.rig('mushroom', [
        ('base', None, (0, 0, 0), (0, 0, 0.45)),
        ('mid', 'base', (0, 0, 0.45), (0, 0, 0.95)),
        ('top', 'mid', (0, 0, 0.95), (0, 0, 1.25)),
        ('crown', 'top', (0, 0, 1.25), (0, 0, CAP_BASE + CAP_HEIGHT)),
    ], [stem, cap, gills, *warts])
    arm.location = (0, 0, ground_height(0, 0) - 0.03)
    kit.animate(arm, 'scale', [(0, (0.78, 0.78, 0.62)), (2, (0.78, 0.78, 0.62)), (3.6, (1.02, 1.02, 1.05)), (4.2, (1, 1, 1))])
    kit.pose(arm, {
        'mid': [(0, (0, 0, 0)), (2, (8, 0, 0)), (3.6, (-5, 0, 0)), (6, (2, 0, 0))],
        'top': [(0, (0, 0, 0)), (2, (14, 0, 0)), (3.6, (-8, 0, 0)), (6, (3, 0, 0))],
        'crown': [(0, (0, 0, 0)), (2, (10, 0, 0)), (3.6, (-4, 0, 0)), (6, (-2, 0, 0))],
    })
    kit.animate_glow(stem_mat, [(0, 0), (2.2, 0), (4, 0.3), (6, 0.45)])
    kit.animate_glow(cap_mat, [(0, 0), (2.2, 0), (4, 0.45), (6, 0.7)])
    kit.animate_glow(gill_mat, [(0, 0), (2.2, 0), (4, 0.3), (6, 0.45)])
    kit.animate_glow(wart_mat, [(0, 0), (2.2, 0), (4, 0.5), (6, 0.8)])

    glow = kit.light('POINT', location=(0, 0, 0.95), power=0, tint='#ff9a4d', size=0.3)
    kit.key(glow.data, 'energy', 2.2, 0)
    kit.key(glow.data, 'energy', 4, 18)
    kit.key(glow.data, 'energy', 6, 28)
    kit.wobble(glow.data, 'energy', amount=5, speed=2)


def build(ctx):
    kit.gradient_world(zenith='#1c2c66', horizon='#ff9a5c', ground='#0c0a0a', strength=1.5)
    kit.light('SUN', location=(-10, 14, 3), target=(0, 0, 0), power=4.5, tint='#ff9a66', size=6)

    soil = kit.material('soil', '#20301a', roughness=0.95, variation=('#3d4a1f', 3), bump=(0.7, 18))
    ground = kit.terrain('ground', (44, 44), 240 if not ctx.low_quality else 120, ground_height, soil)
    moss = kit.material('moss', '#557a26', roughness=0.8, variation=('#94a438', 4), sheen=0.5)
    kit.hair(ground, count=90000, length=0.09, mat=moss, children=12, root=0.006, messy=0.25, clump=0.35, seed=2)

    rock_mat = kit.material('rock', '#55524e', roughness=0.85, variation=('#2e332a', 2.5), bump=(0.8, 12), wear=(0.2, 5))
    rocks = kit.library('rocks')
    for index in range(4):
        rock = kit.sphere(f'rock{index}', 1.0, rock_mat, detail=5)
        rock.scale = (1.0, 0.8, 0.55)
        kit.displace(rock, 0.35, 1.2, seed=index)
        bpy.context.scene.collection.objects.unlink(rock)
        rocks.objects.link(rock)
    kit.scatter(ground, rocks, density=0.07, scale=(0.15, 0.7), seed=5, tilt=15,
                weight=lambda x, y, z: min(1.0, max(0.0, (x * x + y * y - 3) / 10)))

    r = kit.rng(9)
    build_mushroom(r)

    fly_mat = kit.material('fly', '#000000', emission='#d9ff7a', glow=60)
    for index in range(26):
        a = r.uniform(0, math.tau)
        d = r.uniform(1.6, 3)
        z = r.uniform(0.5, 2.6)
        fly = kit.sphere(f'fly{index}', 0.012, fly_mat, detail=3)
        path = []
        for step in range(5):
            path.append((step * 1.5, (math.cos(a + step * 0.5) * d + r.uniform(-0.3, 0.3), math.sin(a + step * 0.5) * d + r.uniform(-0.3, 0.3), z + r.uniform(-0.3, 0.3))))
        kit.animate(fly, 'location', path)

    kit.haze(size=(24, 24, 6), center=(0, 0, 3), density=0.012, tint='#ffe2cf', falloff=3)

    # A long lens from low down opens with the mushroom large against the sky.
    wide, wide_aim = kit.camera('wide', lens=65, location=(4.6, -8.2, 1.15), target=(0, 0, 1.2), fstop=2.8)
    kit.animate(wide, 'location', [(0, (4.6, -8.2, 1.15)), (2, (4.0, -7.2, 1.05))], interp='LINEAR')
    close, close_aim = kit.camera('close', lens=50, location=(1.7, -3.3, 0.5), target=(0, 0, 0.95), fstop=2.4)
    kit.animate(close, 'location', [(2, (1.7, -3.3, 0.5)), (4, (1.1, -3.6, 0.8))])
    kit.animate(close_aim, 'location', [(2, (0, 0, 0.95)), (4, (0, 0, 1.15))])
    hero, hero_aim = kit.camera('hero', lens=38, location=(-2.2, -4.4, 0.75), target=(0, 0, 1.1), fstop=3.2)
    kit.animate(hero, 'location', [(4, (-2.2, -4.4, 0.75)), (6, (-3.0, -5.2, 1.6))])
    kit.animate(hero_aim, 'location', [(4, (0, 0, 1.1)), (6, (0, 0, 1.05))])
    for seed, cam in enumerate((wide, close, hero)):
        kit.wobble(cam, 'location', amount=0.008, speed=0.5, seed=seed)

    kit.cut(0, wide)
    kit.cut(2, close)
    kit.cut(4, hero)
