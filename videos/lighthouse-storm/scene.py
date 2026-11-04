# 0-2.2s  long lens from the open sea: the lighthouse on its rocks, beams sweeping, a swell breaks on the reef
# 2.2-4.2s closer on the reef as the next wave explodes up the rocks, lit by a lightning flash
# 4.2-6s  low angle on the tower: lightning behind it, the beam swings through the lens, the spray falls away
#
# Look: night storm under a broken overcast, cold moonlight as the key, warm lamp as the accent.
# Sea, spray and rain are stateless functions of time, so every frame renders independently.
import math

import bpy
import kit
import numpy as np
from mathutils import Vector

config = dict(duration=6, fps=24, width=1920, height=1080, seed=7, samples=20, bounces=6, exposure=0.7)

# The lighthouse
LX, LY = 3.0, 22.0
Z0 = 10.6
TOWER = 25.0

# Swells travel along WAVE_DIR and reach the reef every WAVE_LEN / WAVE_SPEED seconds.
WAVE_DIR = np.array((0.22, 0.975, 0.0))
WAVE_DIR /= np.linalg.norm(WAVE_DIR)
WAVE_SPEED = 11.0
WAVE_LEN = 26.0
WAVE_PHASE = -44.0
WAVE_HEIGHT = 1.7

# Plumes the cameras are framed for: seaward reef faces as (x, y, which crest, power). Crest 1 lands in the
# reef shot with the lightning, crest 2 in the tower shot, and crest -1 is still falling when the video opens.
PLUMES = [
    (12, -42, -1, 1.1), (12, -42, 0, 1.25), (-22, -35.5, 0, 1.05), (-6, -48, 1, 1.0),
    (-22, -35.5, 1, 1.3), (12, -42, 1, 1.5), (31, -22, 0, 1.0),
    (12, -42, 2, 0.85), (31, -22, 1, 1.1),
]

MOON = Vector((-0.42, -0.62, 0.66)).normalized()
HORIZON = '#070b12'

CAMERA_SPOTS = [(-36, -172, 8), (52, -93, 12.5), (-27, -59, 8.5)]
SPRAY_WIND = (-3.2, 2.2, 0.0)

REEFS = [(-22, -26, 7.5, 9), (12, -31, 8.5, 10), (31, -14, 6.5, 8), (-37, -6, 7, 8), (-6, -42, 5.5, 7), (40, 6, 6, 9)]


def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def set_interpolation(owner, mode, match=''):
    """Sets existing keys directly. New-key preferences don't reliably apply in a background render."""
    for curve in kit.fcurves(owner):
        if match in curve.data_path:
            for point in curve.keyframe_points:
                point.interpolation = mode


def rock_height(x, y):
    e = math.sqrt((x / 46) ** 2 + ((y - 14) / 38) ** 2)
    h = 15 * (1 - e ** 1.6) - 1.0
    h += 5.0 * kit.fbm(x * 0.045 + 3, y * 0.045, octaves=3)
    for rx, ry, top, radius in REEFS:
        d2 = ((x - rx) ** 2 + (y - ry) ** 2) / radius ** 2
        if d2 < 9:
            h = max(h, top * math.exp(-d2) - 2.5)
    # Layered rock breaks into ledges, then fine noise roughens the faces.
    ridge = 1 - abs(kit.fbm(x * 0.14, y * 0.14, 7, octaves=4))
    h += (ridge - 0.5) * 6.5 * max(0.0, min(1.0, (h + 5) / 5))
    # Bedding planes dip across the island, so ledges cut the contours rather than follow them.
    tilted = h + x * 0.16 - y * 0.09 + kit.fbm(x * 0.05, y * 0.05, 3, octaves=2) * 1.5
    h += (round(tilted / 2.7) * 2.7 - tilted) * 0.3
    h += kit.fbm(x * 0.9, y * 0.9, octaves=3) * 0.28
    r = math.hypot(x - LX, y - LY)
    flat = float(smooth(15, 7.5, r))
    h = h + (Z0 + 0.2 - h) * flat
    return max(h, -9.0)


# --- Geometry node helpers ---

class Graph:
    def __init__(self, name):
        self.tree = bpy.data.node_groups.new(name, 'GeometryNodeTree')
        self.tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
        self.tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        self.start = self.tree.nodes.new('NodeGroupInput')
        self.end = self.tree.nodes.new('NodeGroupOutput')
        self.time = self.tree.nodes.new('GeometryNodeInputSceneTime').outputs['Seconds']

    def node(self, kind, **props):
        node = self.tree.nodes.new(kind)
        for key, value in props.items():
            setattr(node, key, value)
        return node

    def put(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, op, a, b=None, c=None):
        node = self.node('ShaderNodeMath', operation=op)
        for index, value in enumerate((a, b, c)):
            if value is not None:
                self.put(node.inputs[index], value)
        return node.outputs[0]

    def vec(self, op, a, b=None, scale=None):
        node = self.node('ShaderNodeVectorMath', operation=op)
        self.put(node.inputs[0], a)
        if b is not None:
            self.put(node.inputs[1], b)
        if scale is not None:
            self.put(node.inputs['Scale'], scale)
        return node.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH') else node.outputs['Vector']

    def attr(self, name, kind='FLOAT'):
        node = self.node('GeometryNodeInputNamedAttribute', data_type=kind)
        node.inputs['Name'].default_value = name
        return node.outputs['Attribute']

    def xyz(self, x, y, z):
        node = self.node('ShaderNodeCombineXYZ')
        for index, value in enumerate((x, y, z)):
            self.put(node.inputs[index], value)
        return node.outputs[0]


def set_attributes(obj, floats=None, vectors=None):
    data = obj.data
    for name, values in (floats or {}).items():
        data.attributes.new(name, 'FLOAT', 'POINT').data.foreach_set('value', np.asarray(values, dtype=np.float32))
    for name, values in (vectors or {}).items():
        data.attributes.new(name, 'FLOAT_VECTOR', 'POINT').data.foreach_set('vector', np.asarray(values, dtype=np.float32).ravel())
    data.update()


def attach(obj, graph, output):
    graph.tree.links.new(output, graph.end.inputs[0])
    obj.modifiers.new(graph.tree.name, 'NODES').node_group = graph.tree


# --- Sea ---

def graded_axis(low, high, step, far, growth=1.05):
    values = list(np.arange(low, high + step, step))
    grow = step
    while values[-1] < far:
        grow *= growth
        values.append(values[-1] + grow)
    grow = step
    while values[0] > -far:
        grow *= growth
        values.insert(0, values[0] - grow)
    return np.array(values)


def build_sea(ctx, lookup):
    step = 1.0 if ctx.low_quality else 0.42
    xs = graded_axis(-125, 125, step, 2600)
    ys = graded_axis(-215, 70, step, 2600)
    nx, ny = len(xs), len(ys)
    gx, gy = np.meshgrid(xs, ys)
    verts = np.column_stack((gx.ravel(), gy.ravel(), np.zeros(nx * ny)))
    a = (np.arange(ny - 1)[:, None] * nx + np.arange(nx - 1)[None, :]).ravel()
    faces = np.column_stack((a, a + 1, a + nx + 1, a + nx)).tolist()

    data = bpy.data.meshes.new('sea')
    data.from_pydata(verts.tolist(), [], faces)
    data.update()
    data.shade_smooth()
    sea = kit.link(bpy.data.objects.new('sea', data))

    x, y = verts[:, 0], verts[:, 1]
    h = lookup(x, y)
    shore = smooth(-8.0, -1.0, h)
    variation = 0.8 + 0.28 * np.sin(x * 0.031 + y * 0.006 + 1.0) + 0.18 * np.sin(x * 0.083 - y * 0.012)
    distance = np.hypot(x, y)
    env = variation * (1 + 0.5 * shore) * (1 - 0.85 * smooth(-0.5, 2.0, h)) * (1 - 0.8 * smooth(500.0, 1400.0, distance))
    set_attributes(sea, {'env': env, 'shore': shore}, {'rest': verts})

    ocean = sea.modifiers.new('ocean', 'OCEAN')
    ocean.geometry_mode = 'DISPLACE'
    ocean.spatial_size = 90
    ocean.resolution = 8 if ctx.low_quality else 10
    ocean.viewport_resolution = ocean.resolution
    ocean.wave_scale = 1.5
    ocean.choppiness = 1.3
    ocean.wind_velocity = 17
    ocean.wave_alignment = 0.55
    ocean.wave_direction = math.atan2(WAVE_DIR[1], WAVE_DIR[0])
    ocean.damping = 0.5
    ocean.depth = 60
    ocean.random_seed = 11
    ocean.use_foam = True
    ocean.foam_coverage = 0.25
    ocean.foam_layer_name = 'foam'
    kit.key(ocean, 'time', 0, 10.0, 'LINEAR')
    kit.key(ocean, 'time', ctx.duration, 10.0 + ctx.duration, 'LINEAR')
    set_interpolation(sea, 'LINEAR')

    # Timed swells on top of the ocean, which is what lets spray bursts land exactly on an impact.
    g = Graph('swells')
    d = tuple(float(v) for v in WAVE_DIR)
    rest = g.attr('rest', 'FLOAT_VECTOR')
    along = g.vec('DOT_PRODUCT', rest, d)
    phi = g.math('DIVIDE', g.math('SUBTRACT', along, g.math('ADD', g.math('MULTIPLY', g.time, WAVE_SPEED), WAVE_PHASE)), WAVE_LEN)
    u = g.math('SUBTRACT', phi, g.math('FLOOR', phi))
    angle = g.math('MULTIPLY', u, math.tau)
    crest = g.math('POWER', g.math('ADD', g.math('MULTIPLY', g.math('COSINE', angle), 0.5), 0.5), 5.0)
    env_attr = g.attr('env')
    amount = g.math('MULTIPLY', crest, env_attr)
    lean = g.math('MULTIPLY', g.math('MULTIPLY', amount, g.math('SINE', angle)), -1.1)
    offset = g.vec('ADD', g.vec('SCALE', d, scale=lean), g.xyz(0, 0, g.math('MULTIPLY', amount, WAVE_HEIGHT)))
    store = g.node('GeometryNodeStoreNamedAttribute', data_type='FLOAT', domain='POINT')
    g.put(store.inputs['Geometry'], g.start.outputs[0])
    store.inputs['Name'].default_value = 'crest'
    g.put(store.inputs['Value'], amount)
    move = g.node('GeometryNodeSetPosition')
    g.put(move.inputs['Geometry'], store.outputs[0])
    g.put(move.inputs['Offset'], offset)
    attach(sea, g, move.outputs[0])

    kit.set_material(sea, sea_material(ctx))
    sea.cycles.use_deform_motion = not ctx.low_quality
    return sea


def sea_material(ctx):
    mat = bpy.data.materials.new('sea')
    tree = mat.node_tree
    tree.nodes.clear()
    new = tree.nodes.new
    wire = tree.links.new

    def attribute(name):
        node = new('ShaderNodeAttribute')
        node.attribute_name = name
        return node.outputs['Fac']

    def maths(op, a, b, clamp=False):
        node = new('ShaderNodeMath')
        node.operation = op
        node.use_clamp = clamp
        for index, value in enumerate((a, b)):
            if isinstance(value, bpy.types.NodeSocket):
                wire(value, node.inputs[index])
            else:
                node.inputs[index].default_value = value
        return node.outputs[0]

    coords = new('ShaderNodeTexCoord').outputs['Object']

    def churn(scale, detail, keys):
        node = new('ShaderNodeTexNoise')
        node.noise_dimensions = '4D'
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Distortion'].default_value = 0.6
        wire(coords, node.inputs['Vector'])
        for t, value in keys:
            kit.key(node.inputs['W'], 'default_value', t, value, 'LINEAR')
        return node.outputs[0]

    coarse = churn(0.38, 6.0, [(0, 0.0), (ctx.duration, 1.4)])
    fine = churn(2.1, 8.0, [(0, 3.0), (ctx.duration, 6.0)])

    crest = attribute('crest')
    shore = attribute('shore')
    mask = maths('ADD', maths('MULTIPLY', attribute('foam'), 0.35), maths('MULTIPLY', crest, maths('ADD', 0.04, maths('MULTIPLY', shore, 0.46))))
    mask = maths('ADD', mask, maths('MULTIPLY', shore, 0.09), clamp=True)
    pattern = maths('ADD', maths('MULTIPLY', coarse, 0.55), maths('MULTIPLY', fine, 0.45))
    edge = new('ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = 0.0
    edge.inputs['From Max'].default_value = 0.42
    wire(maths('SUBTRACT', maths('ADD', mask, pattern), 1.0), edge.inputs['Value'])
    # Foam is a net of bubbles and streaks: cell walls from a Voronoi pattern, stretched by the churn.
    cells = new('ShaderNodeTexVoronoi')
    cells.feature = 'DISTANCE_TO_EDGE'
    cells.inputs['Scale'].default_value = 1.7
    cells.inputs['Randomness'].default_value = 1.0
    bend = new('ShaderNodeVectorMath')
    bend.operation = 'SCALE'
    bend.inputs['Scale'].default_value = 2.6
    wire(fine, bend.inputs[0])
    warp = new('ShaderNodeVectorMath')
    warp.operation = 'ADD'
    wire(coords, warp.inputs[0])
    wire(bend.outputs[0], warp.inputs[1])
    wire(warp.outputs[0], cells.inputs['Vector'])
    walls = new('ShaderNodeMapRange')
    walls.interpolation_type = 'SMOOTHSTEP'
    walls.inputs['From Min'].default_value = 0.0
    walls.inputs['From Max'].default_value = 0.2
    walls.inputs['To Min'].default_value = 1.0
    walls.inputs['To Max'].default_value = 0.14
    wire(cells.outputs['Distance'], walls.inputs['Value'])
    foam = maths('MULTIPLY', edge.outputs['Result'], walls.outputs['Result'])

    deep = new('ShaderNodeMix')
    deep.data_type = 'RGBA'
    wire(maths('MULTIPLY', crest, 0.55), deep.inputs[0])
    deep.inputs[6].default_value = kit.color('#04101a')
    deep.inputs[7].default_value = kit.color('#0f3a44')
    paint = new('ShaderNodeMix')
    paint.data_type = 'RGBA'
    wire(foam, paint.inputs[0])
    wire(deep.outputs[2], paint.inputs[6])
    paint.inputs[7].default_value = kit.color('#8b9aa3')

    bsdf = new('ShaderNodeBsdfPrincipled')
    wire(paint.outputs[2], bsdf.inputs['Base Color'])
    rough = new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.14
    rough.inputs['To Max'].default_value = 0.8
    wire(foam, rough.inputs['Value'])
    wire(rough.outputs['Result'], bsdf.inputs['Roughness'])
    bump = new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.12
    wire(fine, bump.inputs['Height'])
    wire(bump.outputs['Normal'], bsdf.inputs['Normal'])

    # Far water melts into the storm, in place of a costly volume.
    position = new('ShaderNodeNewGeometry').outputs['Position']
    length = new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    wire(position, length.inputs[0])
    fade = new('ShaderNodeMapRange')
    fade.interpolation_type = 'SMOOTHSTEP'
    fade.inputs['From Min'].default_value = 450
    fade.inputs['From Max'].default_value = 1900
    wire(length.outputs['Value'], fade.inputs['Value'])
    distant = new('ShaderNodeEmission')
    distant.inputs['Color'].default_value = kit.color(HORIZON)
    mix = new('ShaderNodeMixShader')
    wire(fade.outputs['Result'], mix.inputs[0])
    wire(bsdf.outputs[0], mix.inputs[1])
    wire(distant.outputs[0], mix.inputs[2])
    wire(mix.outputs[0], new('ShaderNodeOutputMaterial').inputs['Surface'])
    set_interpolation(tree, 'LINEAR')
    return mat


# --- Spray and rain ---

def impact_time(along, rng_offset=0.0):
    return (along - WAVE_PHASE) / WAVE_SPEED + rng_offset


def spray_graph(name, material, grow=False):
    """Ballistic particles with drag, written as a closed form of time so nothing has to be simulated."""
    g = Graph(name)
    age = g.math('MAXIMUM', g.math('SUBTRACT', g.time, g.attr('t0')), 0.0)
    k = g.attr('drag')
    decay = g.math('DIVIDE', g.math('SUBTRACT', 1.0, g.math('POWER', 2.71828, g.math('MULTIPLY', g.math('MULTIPLY', k, age), -1.0))), k)
    wind = SPRAY_WIND
    v0 = g.vec('SUBTRACT', g.attr('vel', 'FLOAT_VECTOR'), wind)
    moved = g.vec('ADD', g.vec('SCALE', v0, scale=decay), g.vec('SCALE', wind, scale=age))
    fall = g.math('MULTIPLY', g.math('DIVIDE', -9.81, k), g.math('SUBTRACT', age, decay))
    offset = g.vec('ADD', moved, g.xyz(0, 0, fall))
    # Cycles streaks points along this attribute, in meters per second, for motion blur.
    remain = g.math('POWER', 2.71828, g.math('MULTIPLY', g.math('MULTIPLY', k, age), -1.0))
    speed = g.vec('ADD', g.vec('SCALE', v0, scale=remain), wind)
    speed = g.vec('ADD', speed, g.xyz(0, 0, g.math('MULTIPLY', g.math('DIVIDE', -9.81, k), g.math('SUBTRACT', 1.0, remain))))
    store = g.node('GeometryNodeStoreNamedAttribute', data_type='FLOAT_VECTOR', domain='POINT')
    g.put(store.inputs['Geometry'], g.start.outputs[0])
    store.inputs['Name'].default_value = 'velocity'
    g.put(store.inputs['Value'], speed)
    move = g.node('GeometryNodeSetPosition')
    g.put(move.inputs['Geometry'], store.outputs[0])
    g.put(move.inputs['Offset'], offset)

    life = g.attr('life')
    born = g.math('GREATER_THAN', g.time, g.attr('t0'))
    remaining = g.math('SUBTRACT', life, age)
    fade = g.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
    fade.inputs['From Min'].default_value = 0.0
    fade.inputs['From Max'].default_value = 0.7
    g.put(fade.inputs['Value'], remaining)
    radius = g.math('MULTIPLY', g.math('MULTIPLY', g.attr('size'), fade.outputs['Result']), born)
    radius = g.math('MULTIPLY', radius, g.math('GREATER_THAN', g.attr('until'), g.time))
    if grow:
        radius = g.math('MULTIPLY', radius, g.math('ADD', 1.0, g.math('MULTIPLY', age, 1.1)))
        # A puff cut by the water would show a hard circle, so it shrinks clear of the surface instead.
        height = g.node('ShaderNodeSeparateXYZ')
        g.put(height.inputs[0], g.node('GeometryNodeInputPosition').outputs[0])
        clearance = g.math('MULTIPLY', g.math('MAXIMUM', g.math('SUBTRACT', height.outputs['Z'], 0.9), 0.0), 0.8)
        radius = g.math('MINIMUM', radius, clearance)
    points = g.node('GeometryNodeMeshToPoints')
    g.put(points.inputs['Mesh'], move.outputs[0])
    g.put(points.inputs['Radius'], radius)
    paint = g.node('GeometryNodeSetMaterial')
    g.put(paint.inputs['Geometry'], points.outputs[0])
    paint.inputs['Material'].default_value = material
    return g, paint.outputs[0]


def build_spray(ctx, xs, ys, grid):
    gen = np.random.default_rng(21)
    # Rock faces at the waterline that look out to sea are where water gets thrown upward.
    dy, dx = np.gradient(grid, ys, xs)
    seaward = dx * WAVE_DIR[0] + dy * WAVE_DIR[1]
    mask = (grid > -1.8) & (grid < 1.6) & (seaward > 0.12)
    rows, cols = np.nonzero(mask)
    cx, cy = xs[cols], ys[rows]
    cz = np.maximum(grid[rows, cols], 0.0)
    nx, ny = -dx[rows, cols], -dy[rows, cols]
    norm = np.maximum(np.hypot(nx, ny), 1e-3)
    nx, ny = nx / norm, ny / norm
    along = cx * WAVE_DIR[0] + cy * WAVE_DIR[1]

    period = WAVE_LEN / WAVE_SPEED
    bursts = []
    for wave in range(-1, 4):
        for _ in range(26):
            i = gen.integers(len(cx))
            base = impact_time(along[i]) % period
            t0 = base + (wave * period)
            if -1.6 < t0 < 6.0:
                bursts.append((i, t0, gen.uniform(0.55, 1.0), 1.0))

    # The framed plumes get most of the water, thrown back out to sea off the reef.
    first = len(cx)
    points = np.array([(x, y) for x, y, _, _ in PLUMES])
    cx = np.append(cx, points[:, 0])
    cy = np.append(cy, points[:, 1])
    cz = np.append(cz, np.zeros(len(PLUMES)))
    nx = np.append(nx, np.full(len(PLUMES), -WAVE_DIR[0]))
    ny = np.append(ny, np.full(len(PLUMES), -WAVE_DIR[1]))
    for offset, (x, y, crest, power) in enumerate(PLUMES):
        arrival = impact_time(x * WAVE_DIR[0] + y * WAVE_DIR[1])
        bursts.append((first + offset, arrival + crest * period, power, 28.0))
    bursts = np.array(bursts)
    index = bursts[:, 0].astype(int)
    chance = bursts[:, 3] / bursts[:, 3].sum()

    plume_only = (bursts[:, 3] > 1) / (bursts[:, 3] > 1).sum()

    def emit(count, spread, up, out, drag, life, size, jitter, weights=chance):
        pick = gen.choice(len(bursts), size=count, p=weights)
        i = index[pick]
        power = bursts[pick, 2]
        t0 = bursts[pick, 1] + gen.exponential(jitter, count)
        p = np.column_stack((
            cx[i] + gen.normal(0, spread, count),
            cy[i] + gen.normal(0, spread, count),
            cz[i] + gen.uniform(0.0, 1.0, count),
        ))
        vertical = up[0] + (up[1] - up[0]) * gen.beta(1.6, 2.6, count)
        outward = out[0] + (out[1] - out[0]) * gen.random(count)
        side = gen.normal(0, 2.2, count)
        vel = np.column_stack((
            nx[i] * outward - ny[i] * side,
            ny[i] * outward + nx[i] * side,
            vertical * power,
        ))
        d = gen.uniform(drag[0], drag[1], count)
        l = gen.uniform(life[0], life[1], count)
        r = size[0] + (size[1] - size[0]) * gen.random(count) ** 3
        # Anything drifting right past the tower shot's lens would look like a huge snowflake, so it goes.
        wind = np.array(SPRAY_WIND)
        eye = np.array(CAMERA_SPOTS[2])
        for t in np.arange(4.2, 6.01, 0.3):
            a = np.maximum(t - t0, 0.0)[:, None]
            decay = (1 - np.exp(-d[:, None] * a)) / d[:, None]
            at = p + (vel - wind) * decay + wind * a
            at[:, 2] -= 9.81 / d * (a[:, 0] - decay[:, 0])
            alive = (t > t0) & (t - t0 < l)
            r[alive & (np.linalg.norm(at - eye, axis=1) < 24)] = 0.0
        # Spray from the reef shot would hang around the tower, so it ends on the cut, where nobody can see it go.
        until = np.where(t0 < 4.2, 4.24, 100.0)
        return {'t0': t0, 'drag': d, 'life': l, 'size': r, 'until': until}, {'vel': vel}, p

    mesh_of = lambda name, p: kit.mesh(name, p.tolist(), [], smooth=False)

    water = kit.material('spray', '#d7e3ea', roughness=0.35, emission='#a8bccd', glow=0.4)
    count = 120000 if ctx.low_quality else 480000
    floats, vectors, p = emit(count, 2.2, (8, 26), (0.5, 6), (0.28, 0.95), (1.8, 3.4), (0.008, 0.036), 0.2)
    droplets = mesh_of('droplets', p)
    set_attributes(droplets, floats, vectors)
    attach(droplets, *spray_graph('droplets', water))

    mist = bpy.data.materials.new('mist')
    tree = mist.node_tree
    tree.nodes.clear()
    weight = tree.nodes.new('ShaderNodeLayerWeight')
    weight.inputs['Blend'].default_value = 0.5
    ramp = tree.nodes.new('ShaderNodeMapRange')
    ramp.interpolation_type = 'SMOOTHSTEP'
    ramp.inputs['From Min'].default_value = 0.0
    ramp.inputs['From Max'].default_value = 0.6
    ramp.inputs['To Min'].default_value = 0.82
    ramp.inputs['To Max'].default_value = 1.0
    tree.links.new(weight.outputs['Facing'], ramp.inputs['Value'])
    soft = tree.nodes.new('ShaderNodeBsdfPrincipled')
    soft.inputs['Base Color'].default_value = kit.color('#dde6ec')
    soft.inputs['Roughness'].default_value = 0.9
    soft.inputs['Emission Color'].default_value = kit.color('#9db3c6')
    soft.inputs['Emission Strength'].default_value = 0.22
    clear = tree.nodes.new('ShaderNodeBsdfTransparent')
    blend = tree.nodes.new('ShaderNodeMixShader')
    tree.links.new(ramp.outputs['Result'], blend.inputs[0])
    tree.links.new(soft.outputs[0], blend.inputs[1])
    tree.links.new(clear.outputs[0], blend.inputs[2])
    tree.links.new(blend.outputs[0], tree.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])

    floats, vectors, p = emit(7000 if ctx.low_quality else 12000, 3.0, (4, 20), (0.5, 4), (0.9, 1.9), (2.0, 3.4), (0.28, 0.9), 0.3, plume_only)
    puffs = mesh_of('mist', p)
    set_attributes(puffs, floats, vectors)
    attach(puffs, *spray_graph('mist', mist, grow=True))
    puffs.visible_shadow = False


def build_rain(ctx):
    gen = np.random.default_rng(5)
    velocity = np.array((-4.2, 1.8, -13.0))
    forward = velocity / np.linalg.norm(velocity)
    side = np.cross(forward, (1, 0, 0))
    side /= np.linalg.norm(side)
    other = np.cross(forward, side)
    length = 1.5
    radius = 0.018
    verts = []
    for sign in (-0.5, 0.5):
        for k in range(3):
            a = k / 3 * math.tau
            verts.append(tuple(forward * length * sign + (side * math.cos(a) + other * math.sin(a)) * radius))
    streak = kit.mesh('streak', verts, [(0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)], smooth=False)
    mat = bpy.data.materials.new('rain')
    tree = mat.node_tree
    tree.nodes.clear()
    body = tree.nodes.new('ShaderNodeBsdfPrincipled')
    body.inputs['Base Color'].default_value = kit.color('#dbe7f2')
    body.inputs['Roughness'].default_value = 0.3
    body.inputs['Emission Color'].default_value = kit.color('#9ab1c9')
    body.inputs['Emission Strength'].default_value = 0.035
    clear = tree.nodes.new('ShaderNodeBsdfTransparent')
    mix = tree.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = 0.55
    tree.links.new(body.outputs[0], mix.inputs[1])
    tree.links.new(clear.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], tree.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    kit.set_material(streak, mat)
    shelf = kit.library('rain_source')
    bpy.context.scene.collection.objects.unlink(streak)
    shelf.objects.link(streak)

    # No wrapping: a drop that jumped back to the top would smear across the frame under motion blur.
    count = 30000 if ctx.low_quality else 100000
    travel = -velocity * ctx.duration
    low = np.array((-125, -215, 0.0))
    high = np.array((125 + travel[0], 60, 75 + travel[2]))
    p = gen.uniform(low, high, (count, 3))
    # A drop passing right by the lens would blur into a huge bar, so none fall close to a camera.
    for eye in CAMERA_SPOTS:
        offset = p - np.array(eye)
        along = offset @ forward
        miss = np.linalg.norm(offset - along[:, None] * forward, axis=1)
        p = p[miss > 22]
    drops = kit.mesh('rain', p.tolist(), [], smooth=False)

    g = Graph('rain')
    move = g.node('GeometryNodeSetPosition')
    g.put(move.inputs['Geometry'], g.start.outputs[0])
    g.put(move.inputs['Offset'], g.vec('SCALE', tuple(float(v) for v in velocity), scale=g.time))
    place = g.node('GeometryNodeInstanceOnPoints')
    g.put(place.inputs['Points'], move.outputs[0])
    info = g.node('GeometryNodeObjectInfo', transform_space='ORIGINAL')
    info.inputs['Object'].default_value = streak
    g.put(place.inputs['Instance'], info.outputs['Geometry'])
    attach(drops, g, place.outputs[0])
    for obj in (streak, drops):
        obj.visible_shadow = False
        obj.visible_diffuse = False
        obj.visible_glossy = False
        obj.visible_transmission = False


# --- Lighthouse ---

def radius_at(h):
    return 2.75 + 1.65 * (1 - h / TOWER) ** 1.7


def around(angle, radius, z, tilt=0.0):
    return (LX + math.cos(angle) * radius, LY + math.sin(angle) * radius, z)


def build_lighthouse(ctx):
    white = kit.material('tower', '#b9b6aa', roughness=0.7, variation=('#7c7a70', 0.55), bump=(0.45, 7), wear=(0.2, 2))
    red = kit.material('band', '#6d1d18', roughness=0.6, variation=('#3e120f', 0.8), bump=(0.45, 7), wear=(0.2, 2))
    stone = kit.material('stone', '#4a4842', roughness=0.8, variation=('#2d2c29', 1.1), bump=(0.8, 3.5), wear=(0.25, 1.5))
    iron = kit.material('iron', '#15181a', roughness=0.42, metallic=0.9, wear=(0.2, 6), bump=(0.2, 40))
    copper = kit.material('copper', '#2f5a4e', roughness=0.5, metallic=0.5, variation=('#1a302b', 3), wear=(0.25, 4), bump=(0.3, 18))
    glass = kit.material('glass', '#e8f1ee', roughness=0.04, transmission=1.0, ior=1.3)

    def course(h0, h1):
        # Stone courses: a shallow mortar groove every 55 cm, and each ring's blocks offset by noise.
        def shape(u, a):
            h = h0 + (h1 - h0) * u
            groove = abs(math.sin(h / 0.55 * math.pi))
            return 1 - 0.006 * (1 - min(1.0, groove * 7)) + 0.002 * math.sin(a * 37 + round(h / 0.55) * 2.4)
        return shape

    base = [(6.3, Z0 - 1.2), (6.3, Z0 + 0.7), (6.1, Z0 + 0.86), (5.45, Z0 + 0.92), (5.3, Z0 + 1.25), (5.0, Z0 + 1.42), (4.6, Z0 + 1.5), (0.01, Z0 + 1.5)]
    kit.lathe('plinth', [(r, z) for r, z in base], stone, segments=128, steps=70).location = (LX, LY, 0)

    for index, (h0, h1, mat) in enumerate(((0, 9, white), (9, 14.5, red), (14.5, TOWER, white))):
        points = [(radius_at(h0 + (h1 - h0) * k / 8), Z0 + 1.2 + h0 + (h1 - h0) * k / 8) for k in range(9)]
        section = kit.lathe(f'tower{index}', points, mat, segments=128, steps=int((h1 - h0) * 14), shape=course(h0, h1))
        section.location = (LX, LY, 0)

    # A door and spiralling windows, set in stone frames.
    door_angle = math.radians(-100)
    door_h = 0.3
    door_r = radius_at(door_h + 1.3) - 0.08
    door_z = Z0 + 1.5 + 1.25

    def facing(obj, angle):
        obj.rotation_euler = (0, 0, angle + math.pi / 2)
        return obj

    facing(kit.box('door', (1.25, 0.26, 2.5), kit.material('door', '#1a120c', roughness=0.6, bump=(0.5, 12)), around(door_angle, door_r, door_z), bevel=0.02), door_angle)
    for side in (-1, 1):
        offset = door_angle + side * 0.2
        facing(kit.box(f'jamb{side}', (0.32, 0.46, 2.8), stone, around(offset, door_r + 0.02, door_z - 0.05), bevel=0.04), door_angle)
    facing(kit.box('lintel', (1.9, 0.56, 0.42), stone, around(door_angle, door_r + 0.04, door_z + 1.42), bevel=0.04), door_angle)
    lamp_glass = kit.material('window', '#2b1a08', roughness=0.2, emission='#ffb45c', glow=9)
    for index, (angle, h) in enumerate(((-118, 7.3), (-74, 12.8), (-110, 18.2))):
        a = math.radians(angle)
        r = radius_at(h) - 0.06
        z = Z0 + 1.2 + h
        facing(kit.box(f'win{index}', (0.62, 0.2, 1.05), lamp_glass, around(a, r, z), bevel=0.01), a)
        facing(kit.box(f'winframe{index}', (0.9, 0.16, 0.13), stone, around(a, r + 0.04, z + 0.6), bevel=0.02), a)
        facing(kit.box(f'winsill{index}', (0.98, 0.3, 0.13), stone, around(a, r + 0.06, z - 0.58), bevel=0.02), a)
        for side in (-1, 1):
            facing(kit.box(f'winside{index}{side}', (0.14, 0.16, 1.2), stone, around(a + side * 0.42 / r, r + 0.04, z), bevel=0.02), a)

    # Corbel and gallery.
    top = Z0 + 1.2 + TOWER
    kit.lathe('corbel', [(2.7, top - 0.5), (2.82, top), (3.2, top + 0.45), (3.75, top + 0.85), (4.1, top + 1.0), (4.15, top + 1.2), (0.01, top + 1.2)], stone,
              segments=128, steps=44).location = (LX, LY, 0)
    deck = top + 1.2
    ring = lambda name, r, z, t: kit.lathe(name, [(r - t, z), (r, z + t), (r + t, z), (r, z - t), (r - t, z)], iron, segments=128, steps=12)
    for name, z, t in (('railtop', deck + 1.15, 0.045), ('railmid', deck + 0.6, 0.022)):
        ring(name, 4.02, z, t).location = (LX, LY, 0)
    for index in range(40):
        a = index / 40 * math.tau
        kit.cylinder(f'post{index}', 0.028 if index % 4 else 0.05, 1.2, iron, around(a, 4.02, deck + 0.58), segments=10)

    # The lantern room: a drum, glazing with bars, a domed copper roof and a vent.
    drum_h = 1.25
    kit.lathe('drum', [(2.4, deck - 0.02), (2.4, deck + drum_h - 0.1), (2.5, deck + drum_h), (2.5, deck + drum_h + 0.08), (0.01, deck + drum_h + 0.08)], stone,
              segments=128, steps=30).location = (LX, LY, 0)
    floor = deck + drum_h + 0.08
    glaze_h = 3.1
    panes = kit.lathe('glazing', [(2.18, floor), (2.18, floor + glaze_h), (2.13, floor + glaze_h), (2.13, floor)], glass, segments=96, steps=16)
    panes.location = (LX, LY, 0)
    panes.visible_shadow = False
    for index in range(14):
        a = index / 14 * math.tau
        kit.cylinder(f'bar{index}', 0.05, glaze_h, iron, around(a, 2.17, floor + glaze_h / 2), segments=10)
    for z in (floor + glaze_h * 0.34, floor + glaze_h * 0.68):
        ring(f'barring{z:.2f}', 2.18, z, 0.03).location = (LX, LY, 0)
    eaves = floor + glaze_h
    kit.lathe('roof', [(2.62, eaves - 0.02), (2.66, eaves + 0.08), (2.45, eaves + 0.2), (1.75, eaves + 0.95), (0.95, eaves + 1.55), (0.42, eaves + 1.86), (0.34, eaves + 2.3), (0.01, eaves + 2.32)], copper,
              segments=128, steps=60, shape=lambda u, a: 1 + 0.012 * abs(math.sin(a * 8))).location = (LX, LY, 0)
    kit.sphere('vent', 0.44, copper, (LX, LY, eaves + 2.62), detail=4)
    kit.cylinder('finial', 0.035, 1.5, iron, (LX, LY, eaves + 3.7), segments=10, radius_top=0.008)
    lens_z = floor + glaze_h / 2

    # The lens: a fluted glass beehive around a blinding core, on a dark pedestal.
    kit.cylinder('pedestal', 0.25, glaze_h * 0.42, iron, (LX, LY, floor + glaze_h * 0.21), segments=24)
    lens = kit.lathe('lens', [(0.45, lens_z - 0.9), (0.9, lens_z - 0.55), (1.05, lens_z), (0.9, lens_z + 0.55), (0.45, lens_z + 0.9), (0.02, lens_z + 0.92), (0.02, lens_z - 0.92)],
                     glass, segments=96, steps=36, shape=lambda u, a: 1 + 0.03 * abs(math.sin(u * 60)))
    lens.location = (LX, LY, 0)
    core = kit.sphere('core', 0.4, kit.material('core', '#000000', emission='#ffd690', glow=170), (LX, LY, lens_z), detail=4)
    # The spot lights sit inside these, so they must not cast shadows or the beams never leave the lamp.
    lens.visible_shadow = False
    core.visible_shadow = False
    return lens_z


def camera_only(obj):
    obj.visible_diffuse = False
    obj.visible_glossy = False
    obj.visible_transmission = False
    obj.visible_shadow = False
    obj.visible_volume_scatter = False


def build_beams(ctx, lens_z):
    """Two opposed spot lights on a turning pivot. The haze box is what makes the shafts visible."""
    pivot = kit.link(bpy.data.objects.new('pivot', None))
    pivot.location = (LX, LY, lens_z)
    pivot.rotation_mode = 'XYZ'
    start = 7.0
    rate = 45.0
    kit.animate(pivot, 'rotation_euler', [(0, (0, 0, start)), (ctx.duration, (0, 0, start + rate * ctx.duration))], interp='LINEAR')
    set_interpolation(pivot, 'LINEAR')
    for index, angle in enumerate((0, 180)):
        spot = kit.light('SPOT', location=(0, 0, 0), target=(1, 0, 0), power=3000000, tint='#ffe3b0', size=0.4, name=f'lamp{index}')
        spot.data.spot_size = math.radians(8)
        spot.data.spot_blend = 0.6
        spot.parent = pivot
        spot.rotation_mode = 'XYZ'
        spot.rotation_euler = (0, math.radians(90), math.radians(angle))
    kit.light('POINT', location=(LX, LY, lens_z), power=2500, tint='#ffc98a', size=0.5, name='lamp_fill')


# --- Storm ---

def build_sky(ctx):
    world = bpy.data.worlds.new('storm')
    tree = world.node_tree
    tree.nodes.clear()
    new = tree.nodes.new
    wire = tree.links.new
    bpy.context.scene.world = world
    coord = new('ShaderNodeTexCoord').outputs['Generated']

    drift = new('ShaderNodeMapping')
    drift.inputs['Scale'].default_value = (1.0, 1.0, 2.3)
    wire(coord, drift.inputs['Vector'])
    kit.key(drift.inputs['Location'], 'default_value', 0, (0.0, 0.0, 0.0), 'LINEAR')
    kit.key(drift.inputs['Location'], 'default_value', ctx.duration, (0.09, 0.03, 0.0), 'LINEAR')
    noise = new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 2.2
    noise.inputs['Detail'].default_value = 12
    noise.inputs['Roughness'].default_value = 0.62
    noise.inputs['Distortion'].default_value = 0.12
    wire(drift.outputs['Vector'], noise.inputs['Vector'])
    ramp = new('ShaderNodeValToRGB')
    stops = ramp.color_ramp.elements
    stops[0].position = 0.36
    stops[0].color = kit.color('#05070b')
    stops[1].position = 0.74
    stops[1].color = kit.color('#3b465b')
    mid = stops.new(0.55)
    mid.color = kit.color('#141a26')
    wire(noise.outputs[0], ramp.inputs['Fac'])

    # A moon behind the clouds lights up one part of the sky.
    towards = new('ShaderNodeVectorMath')
    towards.operation = 'DOT_PRODUCT'
    wire(coord, towards.inputs[0])
    towards.inputs[1].default_value = (0.45, 0.72, 0.53)
    lift = new('ShaderNodeMapRange')
    lift.interpolation_type = 'SMOOTHSTEP'
    lift.inputs['From Min'].default_value = 0.35
    lift.inputs['From Max'].default_value = 1.0
    lift.inputs['To Min'].default_value = 1.0
    lift.inputs['To Max'].default_value = 1.9
    wire(towards.outputs['Value'], lift.inputs['Value'])
    lit = new('ShaderNodeVectorMath')
    lit.operation = 'SCALE'
    wire(ramp.outputs['Color'], lit.inputs[0])
    wire(lift.outputs['Result'], lit.inputs['Scale'])

    split = new('ShaderNodeSeparateXYZ')
    wire(coord, split.inputs[0])
    edge = new('ShaderNodeMapRange')
    edge.interpolation_type = 'SMOOTHSTEP'
    edge.inputs['From Min'].default_value = -0.01
    edge.inputs['From Max'].default_value = 0.1
    wire(split.outputs['Z'], edge.inputs['Value'])
    mix = new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    wire(edge.outputs['Result'], mix.inputs[0])
    mix.inputs[6].default_value = kit.color(HORIZON)
    wire(lit.outputs['Vector'], mix.inputs[7])

    background = new('ShaderNodeBackground')
    wire(mix.outputs[2], background.inputs['Color'])
    wire(background.outputs[0], new('ShaderNodeOutputWorld').inputs['Surface'])

    moon = kit.light('SUN', location=tuple(MOON * 200), target=(0, 0, 0), power=1.5, tint='#a6bfe6', size=6, name='moon')

    # Lightning: a double strike on the reef shot, then a visible bolt behind the tower.
    flash = kit.light('SUN', location=(170, 300, 260), target=(0, 0, 8), power=0, tint='#c8d6ff', size=14, name='lightning')
    sky_power = background.inputs['Strength']
    strikes = [
        (3.04, 2.0, 3.5), (3.09, 0.5, 1.6), (3.13, 3.0, 4.5), (3.21, 0.9, 2.2), (3.3, 0.3, 1.3),
        (4.75, 2.2, 3.5), (4.8, 0.6, 1.6), (4.84, 3.0, 4.5), (4.96, 1.0, 2.2), (5.08, 0.3, 1.3),
    ]
    kit.key(flash.data, 'energy', 0, 0, 'CONSTANT')
    kit.key(sky_power, 'default_value', 0, 1.0, 'CONSTANT')
    previous_end = {3.3: 3.38, 5.08: 5.2}
    for t, light_power, sky_scale in strikes:
        kit.key(flash.data, 'energy', t, light_power, 'CONSTANT')
        kit.key(sky_power, 'default_value', t, sky_scale, 'CONSTANT')
        if t in previous_end:
            kit.key(flash.data, 'energy', previous_end[t], 0, 'CONSTANT')
            kit.key(sky_power, 'default_value', previous_end[t], 1.0, 'CONSTANT')
    set_interpolation(flash.data, 'CONSTANT')
    set_interpolation(tree, 'LINEAR')
    set_interpolation(tree, 'CONSTANT', background.name)

    # The bolt only exists for the strike behind the tower, far out at sea.
    r = kit.rng(13)
    bolt_mat = kit.material('bolt', '#000000', emission='#d7e2ff', glow=90)
    start = Vector((395, 900, 560))

    def forked(name, origin, drop, width, count):
        points = []
        p = origin.copy()
        for k in range(count):
            points.append((p.x, p.y, p.z, width * (1 - k / count * 0.75)))
            p = p + Vector((r.uniform(-1, 1) * drop * 0.55, r.uniform(-0.5, 0.5) * drop * 0.3, -drop * r.uniform(0.7, 1.25)))
        return kit.loft(name, points, bolt_mat, segments=6, steps=count - 1, cap=True), points

    trunk, points = forked('bolt', start, 26, 1.4, 22)
    pieces = [trunk]
    for branch, at in enumerate((5, 9, 13)):
        px, py, pz, _ = points[at]
        pieces.append(forked(f'bolt_fork{branch}', Vector((px, py, pz)), 15, 0.7, 9)[0])
    for piece in pieces:
        camera_only(piece)
        for t, hidden in ((0, True), (4.75, False), (4.8, True), (4.84, False), (5.0, True)):
            kit.key(piece, 'hide_render', t, hidden, 'CONSTANT')
        set_interpolation(piece, 'CONSTANT')


# --- Rocks ---

def build_rocks(ctx):
    size = 190.0
    resolution = 300 if ctx.low_quality else 560
    heights = []

    def capture(x, y):
        z = rock_height(x, y)
        heights.append(z)
        return z

    mat = kit.material('rock', '#3a3835', roughness=0.42, variation=('#625d53', 0.7), bump=(1.0, 2.6), wear=(0.32, 2.3))
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    painted = bsdf.inputs['Base Color'].links[0].from_socket
    split = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(tree.nodes.new('ShaderNodeNewGeometry').outputs['Position'], split.inputs[0])
    band = tree.nodes.new('ShaderNodeMapRange')
    band.interpolation_type = 'SMOOTHSTEP'
    band.inputs['From Min'].default_value = 0.8
    band.inputs['From Max'].default_value = 4.4
    band.inputs['To Min'].default_value = 1.0
    band.inputs['To Max'].default_value = 0.0
    tree.links.new(split.outputs['Z'], band.inputs['Value'])
    algae = tree.nodes.new('ShaderNodeMix')
    algae.data_type = 'RGBA'
    tree.links.new(band.outputs['Result'], algae.inputs[0])
    tree.links.new(painted, algae.inputs[6])
    algae.inputs[7].default_value = kit.color('#0d1812')
    tree.links.new(algae.outputs[2], bsdf.inputs['Base Color'])

    ground = kit.terrain('rocks', (size, size), resolution, capture, mat)
    nx = resolution
    ny = max(2, round(resolution * size / size))
    grid = np.array(heights).reshape(ny + 1, nx + 1)
    xs = (np.arange(nx + 1) / nx - 0.5) * size
    ys = (np.arange(ny + 1) / ny - 0.5) * size

    def lookup(x, y):
        fx = np.clip((x + size / 2) / size * nx, 0, nx - 1.001)
        fy = np.clip((y + size / 2) / size * ny, 0, ny - 1.001)
        i = fx.astype(int)
        j = fy.astype(int)
        u = fx - i
        v = fy - j
        h = grid[j, i] * (1 - u) * (1 - v) + grid[j, i + 1] * u * (1 - v) + grid[j + 1, i] * (1 - u) * v + grid[j + 1, i + 1] * u * v
        outside = (np.abs(x) >= size / 2) | (np.abs(y) >= size / 2)
        return np.where(outside, -9.0, h)

    # Real boulders overhang, which a height field cannot, so they break up the waterline.
    r = kit.rng(31)
    shapes = []
    for index in range(4):
        boulder = kit.sphere(f'boulder{index}', 1.0, mat, detail=5)
        boulder.scale = (1.0, r.uniform(0.7, 1.0), r.uniform(0.55, 0.85))
        kit.displace(boulder, 0.34, 1.3, seed=index + 1)
        kit.displace(boulder, 0.05, 6, seed=index + 9)
        shapes.append(boulder)
    rows, cols = np.nonzero((grid > -1.6) & (grid < 3.0))
    gen = np.random.default_rng(3)
    order = gen.permutation(len(rows))[:90]
    for index, k in enumerate(order):
        source = shapes[index % 4]
        copy = bpy.data.objects.new(f'b{index}', source.data)
        kit.link(copy)
        s = r.uniform(0.9, 3.6)
        copy.location = (xs[cols[k]], ys[rows[k]], grid[rows[k], cols[k]] - 0.2 * s)
        copy.scale = (s, s * r.uniform(0.7, 1), s * r.uniform(0.5, 0.8))
        copy.rotation_euler = (r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0, math.tau))
    for source in shapes:
        source.location = (0, 0, -40)
    return ground, xs, ys, grid, lookup


def build(ctx):
    bpy.context.scene.cycles.transparent_max_bounces = 40

    ground, xs, ys, grid, lookup = build_rocks(ctx)
    build_sky(ctx)
    build_sea(ctx, lookup)
    build_spray(ctx, xs, ys, grid)
    build_rain(ctx)
    lens_z = build_lighthouse(ctx)
    build_beams(ctx, lens_z)
    kit.haze(size=(340, 430, 135), center=(0, -65, 64), density=0.0032, tint='#c4d0de', scatter_forward=0.3)

    wide, wide_aim = kit.camera('wide', lens=56, location=(-38, -178, 7.5), target=(1, 8, 19), fstop=4)
    kit.animate(wide, 'location', [(0, (-38, -178, 7.5)), (2.2, (-34, -165, 8.0))], interp='LINEAR')
    close, close_aim = kit.camera('reef', lens=58, location=(54, -96, 12), target=(2, -26, 6), fstop=4)
    kit.animate(close_aim, 'location', [(2.2, (2, -26, 6)), (3.3, (3, -26, 7.5)), (4.2, (4, -24, 11))])
    kit.animate(close, 'location', [(2.2, (54, -96, 12)), (4.2, (50, -90, 13))], interp='LINEAR')
    hero, hero_aim = kit.camera('tower', lens=62, location=(-24, -56, 7.5), target=(3, 22, 34), fstop=4)
    kit.animate(hero, 'location', [(4.2, (-24, -56, 7.5)), (6, (-30, -62, 9.5))])
    kit.animate(hero_aim, 'location', [(4.2, (3, 22, 34)), (6, (3, 22, 31.5))])
    for seed, cam in enumerate((wide, close, hero)):
        kit.wobble(cam, 'location', amount=0.07, speed=0.5, seed=seed + 2)
    kit.cut(0, wide)
    kit.cut(2.2, close)
    kit.cut(4.2, hero)
