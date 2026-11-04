# Helpers for Blender scenes: import kit. Anything else can use bpy directly.
# Times are in seconds, lengths in meters, angles in degrees and colors are '#rrggbb' or linear RGB.
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

_fps = 24


class Context:
    def __init__(self, config, low_quality):
        self.config = config
        self.fps = config['fps']
        self.duration = config['duration']
        self.width = config['width']
        self.height = config['height']
        self.seed = config['seed']
        self.low_quality = low_quality  # true in contact sheets, for cutting costs that don't affect the review


def reset(config):
    global _fps
    _fps = config['fps']
    for block in (bpy.data.objects, bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.materials):
        for item in list(block):
            block.remove(item)
    for collection in list(bpy.context.scene.collection.children):
        bpy.data.collections.remove(collection)
    noise.seed_set(config['seed'])
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'BEZIER'
    bpy.context.preferences.edit.keyframe_new_handle_type = 'AUTO_CLAMPED'
    for marker in list(bpy.context.scene.timeline_markers):
        bpy.context.scene.timeline_markers.remove(marker)


def frame(t):
    return 1 + t * _fps


def color(value):
    if isinstance(value, str):
        value = value.lstrip('#')
        channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        value = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*value[:3], 1.0)


def link(obj, collection=None, parent=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


# --- Animation ---

def key(target, path, t, value=None, interp='BEZIER', index=-1):
    """Keys a property at time t. interp: BEZIER (eased), LINEAR or CONSTANT."""
    if value is not None:
        if index >= 0:
            getattr(target, path)[index] = value
        else:
            setattr(target, path, value)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = interp
    target.keyframe_insert(data_path=path, frame=frame(t), index=index)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'BEZIER'


def animate(target, path, keys, interp='BEZIER'):
    """animate(obj, 'location', [(0, (0, 0, 0)), (2, (1, 0, 0))]). Rotations are in degrees."""
    for t, value in keys:
        if path == 'rotation_euler':
            value = tuple(math.radians(v) for v in value)
        key(target, path, t, value, interp)


def fcurves(obj_or_id):
    from bpy_extras import anim_utils
    animation = obj_or_id.animation_data
    if not animation or not animation.action:
        return []
    bag = anim_utils.action_get_channelbag_for_slot(animation.action, animation.action_slot)
    return list(bag.fcurves) if bag else []


def wobble(obj_or_id, path='location', amount=0.01, speed=0.4, seed=0):
    """Adds continuous noise to an animated property: handheld camera, flickering lights, wind."""
    for index, curve in enumerate(c for c in fcurves(obj_or_id) if c.data_path == path):
        mod = curve.modifiers.new('NOISE')
        mod.strength = amount * 2
        mod.scale = max(1.0, _fps / max(speed, 0.01) / 4)
        mod.phase = seed * 7.3 + index * 31.7
        mod.blend_type = 'ADD'


# --- Cameras ---

def camera(name='camera', lens=35, location=(0, -6, 2), target=(0, 0, 1), focus=None, fstop=None, sensor=36):
    """Returns (camera, target_empty). Animate either one's location. The camera always aims at the target.

    focus=None focuses on the target. Pass another object to rack focus to it. fstop enables depth of field:
    2.8 is shallow and cinematic, 8 is mostly sharp.
    """
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = sensor
    data.clip_start = 0.05
    data.clip_end = 20000
    cam = link(bpy.data.objects.new(name, data))
    cam.location = location
    aim = link(bpy.data.objects.new(f'{name}_target', None))
    aim.location = target
    track = cam.constraints.new('TRACK_TO')
    track.target = aim
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    if fstop:
        data.dof.use_dof = True
        data.dof.aperture_fstop = fstop
        data.dof.focus_object = focus or aim
    if bpy.context.scene.camera is None:
        bpy.context.scene.camera = cam
    return cam, aim


def cut(t, cam):
    """Switches to a camera at time t: a hard edit, like a film cut."""
    marker = bpy.context.scene.timeline_markers.new(f'cut_{t}', frame=round(frame(t)))
    marker.camera = cam
    if t <= 0:
        bpy.context.scene.camera = cam


# --- Materials ---

def material(name, base='#cccccc', roughness=0.5, metallic=0.0, emission=None, glow=0.0, transmission=0.0, ior=1.45,
             subsurface=0.0, subsurface_radius=(0.1, 0.05, 0.03), sheen=0.0, coat=0.0, alpha=1.0,
             variation=None, bump=None, wear=None):
    """A physically based material. Nothing needs UVs, because the patterns are 3D noise.

    variation=('#otherColor', scale): blends in a second color, so surfaces never look flat.
    bump=(strength, scale): fine surface relief.
    wear=(amount, scale): changes roughness in patches, the cheapest way to look real.
    """
    mat = bpy.data.materials.new(name)
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    bsdf = tree.nodes.new('ShaderNodeBsdfPrincipled')
    tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    inputs = bsdf.inputs
    inputs['Base Color'].default_value = color(base)
    inputs['Roughness'].default_value = roughness
    inputs['Metallic'].default_value = metallic
    inputs['Transmission Weight'].default_value = transmission
    inputs['IOR'].default_value = ior
    inputs['Subsurface Weight'].default_value = subsurface
    inputs['Subsurface Radius'].default_value = subsurface_radius
    inputs['Sheen Weight'].default_value = sheen
    inputs['Coat Weight'].default_value = coat
    inputs['Alpha'].default_value = alpha
    if emission is not None:
        inputs['Emission Color'].default_value = color(emission)
        inputs['Emission Strength'].default_value = glow

    if variation or bump or wear:
        coords = tree.nodes.new('ShaderNodeTexCoord').outputs['Object']

        def pattern(scale, detail=5.0):
            node = tree.nodes.new('ShaderNodeTexNoise')
            node.inputs['Scale'].default_value = scale
            node.inputs['Detail'].default_value = detail
            tree.links.new(coords, node.inputs['Vector'])
            return node

        if variation:
            other, scale = variation
            ramp = tree.nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].position = 0.35
            ramp.color_ramp.elements[0].color = color(base)
            ramp.color_ramp.elements[1].position = 0.65
            ramp.color_ramp.elements[1].color = color(other)
            tree.links.new(pattern(scale).outputs['Fac'], ramp.inputs['Fac'])
            tree.links.new(ramp.outputs['Color'], inputs['Base Color'])
        if wear:
            amount, scale = wear
            ramp = tree.nodes.new('ShaderNodeMapRange')
            ramp.inputs['From Min'].default_value = 0.35
            ramp.inputs['From Max'].default_value = 0.65
            ramp.inputs['To Min'].default_value = max(0.0, roughness - amount)
            ramp.inputs['To Max'].default_value = min(1.0, roughness + amount)
            tree.links.new(pattern(scale).outputs['Fac'], ramp.inputs['Value'])
            tree.links.new(ramp.outputs['Result'], inputs['Roughness'])
        if bump:
            strength, scale = bump
            node = tree.nodes.new('ShaderNodeBump')
            node.inputs['Strength'].default_value = min(1.0, strength)
            node.inputs['Distance'].default_value = 0.1
            tree.links.new(pattern(scale, 8.0).outputs['Fac'], node.inputs['Height'])
            tree.links.new(node.outputs['Normal'], inputs['Normal'])
    return mat


def set_material(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def animate_glow(mat, keys):
    """animate_glow(mat, [(0, 0), (2, 15)]): fades a material's emission over time."""
    socket = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Emission Strength']
    for t, value in keys:
        socket.default_value = value
        socket.keyframe_insert('default_value', frame=frame(t))


# --- Worlds and lights ---

def _world():
    world = bpy.data.worlds.new('world')
    tree = world.node_tree
    tree.nodes.clear()
    bpy.context.scene.world = world
    return world, tree, tree.nodes.new('ShaderNodeOutputWorld'), tree.nodes.new('ShaderNodeBackground')


def sky(elevation=8.0, azimuth=0.0, strength=1.0, sun_disc=True, sun_size=1.0, sun_intensity=1.0, dust=1.0, air=1.0, ozone=1.0):
    """Physically based daylight, and the main light for outdoor scenes. Sun low = golden hour.

    azimuth: 0 puts the sun at +Y, 90 at +X. Returns the sun's direction, for aligning cameras or lights.
    """
    world, tree, out, background = _world()
    node = tree.nodes.new('ShaderNodeTexSky')
    node.sky_type = 'MULTIPLE_SCATTERING'
    node.sun_disc = sun_disc
    node.sun_size = math.radians(sun_size)
    node.sun_intensity = sun_intensity
    node.sun_elevation = math.radians(elevation)
    node.sun_rotation = math.radians(azimuth)
    node.aerosol_density = dust
    node.air_density = air
    node.ozone_density = ozone
    background.inputs['Strength'].default_value = strength
    tree.links.new(node.outputs['Color'], background.inputs['Color'])
    tree.links.new(background.outputs['Background'], out.inputs['Surface'])
    e = math.radians(elevation)
    a = math.radians(azimuth)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


def gradient_world(zenith='#16233f', horizon='#c97b5a', ground='#1a1512', strength=1.0):
    """A simple graded backdrop for dusk, night, studio or stylized scenes."""
    world, tree, out, background = _world()
    coord = tree.nodes.new('ShaderNodeTexCoord')
    separate = tree.nodes.new('ShaderNodeSeparateXYZ')
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    remap = tree.nodes.new('ShaderNodeMapRange')
    remap.inputs['From Min'].default_value = -1
    remap.inputs['From Max'].default_value = 1
    tree.links.new(coord.outputs['Generated'], separate.inputs[0])
    tree.links.new(separate.outputs['Z'], remap.inputs['Value'])
    tree.links.new(remap.outputs['Result'], ramp.inputs['Fac'])
    stops = ramp.color_ramp.elements
    stops[0].position = 0.46
    stops[0].color = color(ground)
    stops[1].position = 0.75
    stops[1].color = color(zenith)
    middle = stops.new(0.51)
    middle.color = color(horizon)
    background.inputs['Strength'].default_value = strength
    tree.links.new(ramp.outputs['Color'], background.inputs['Color'])
    tree.links.new(background.outputs['Background'], out.inputs['Surface'])


def light(kind='AREA', location=(3, -3, 4), target=(0, 0, 1), power=100.0, tint='#ffffff', size=1.0, name=None):
    """kind: SUN (power in sunlight units, try 1 to 6), AREA, SPOT or POINT (power in watts). Bigger size = softer."""
    data = bpy.data.lights.new(name or kind.lower(), kind)
    data.energy = power
    data.color = color(tint)[:3]
    if kind == 'AREA':
        data.size = size
    elif kind == 'SUN':
        data.angle = math.radians(size)
    else:
        data.shadow_soft_size = size
    obj = link(bpy.data.objects.new(data.name, data))
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


def haze(size=(60, 60, 12), center=(0, 0, 5), density=0.01, tint='#ffffff', scatter_forward=0.5, falloff=None):
    """Atmosphere in a box around the action: depth, light shafts and mood. Slows rendering, so keep the box small.

    falloff: height in meters over which the haze thins out upward, like ground mist.
    """
    obj = box('haze', size, location=center)
    mat = bpy.data.materials.new('haze')
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    volume = tree.nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = color(tint)
    volume.inputs['Density'].default_value = density
    volume.inputs['Anisotropy'].default_value = scatter_forward
    tree.links.new(volume.outputs['Volume'], out.inputs['Volume'])
    if falloff:
        coord = tree.nodes.new('ShaderNodeNewGeometry')
        separate = tree.nodes.new('ShaderNodeSeparateXYZ')
        remap = tree.nodes.new('ShaderNodeMapRange')
        remap.inputs['From Min'].default_value = center[2] - size[2] / 2
        remap.inputs['From Max'].default_value = center[2] - size[2] / 2 + falloff
        remap.inputs['To Min'].default_value = density
        remap.inputs['To Max'].default_value = 0
        tree.links.new(coord.outputs['Position'], separate.inputs[0])
        tree.links.new(separate.outputs['Z'], remap.inputs['Value'])
        tree.links.new(remap.outputs['Result'], volume.inputs['Density'])
    set_material(obj, mat)
    obj.display_type = 'WIRE'
    return obj


# --- Geometry ---

def mesh(name, verts, faces, mat=None, smooth=True, parent=None, location=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    data.update()
    if smooth:
        data.shade_smooth()
    obj = link(bpy.data.objects.new(name, data), parent=parent)
    if location:
        obj.location = location
    if mat:
        set_material(obj, mat)
    return obj


def _from_bmesh(name, build, mat, location, smooth, parent):
    bm = bmesh.new()
    build(bm)
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    if smooth:
        data.shade_smooth()
    obj = link(bpy.data.objects.new(name, data), parent=parent)
    obj.location = location
    if mat:
        set_material(obj, mat)
    return obj


def sphere(name, radius=1.0, mat=None, location=(0, 0, 0), detail=5, parent=None):
    return _from_bmesh(name, lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=radius), mat, location, True, parent)


def box(name, size=(1, 1, 1), mat=None, location=(0, 0, 0), bevel=0.0, parent=None):
    def build(bm):
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((*size, 1)))
        if bevel:
            bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=3, affect='EDGES', profile=0.5)
    return _from_bmesh(name, build, mat, location, bool(bevel), parent)


def cylinder(name, radius=0.5, depth=1.0, mat=None, location=(0, 0, 0), segments=48, radius_top=None, parent=None):
    top = radius if radius_top is None else radius_top
    return _from_bmesh(
        name,
        lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=top, depth=depth),
        mat, location, True, parent,
    )


def _catmull(points, u):
    last = len(points) - 1
    f = u * last
    i = min(int(f), last - 1)
    s = f - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[i + 1]
    p3 = points[min(i + 2, last)]
    return 0.5 * ((2 * p1) + (p2 - p0) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (3 * p1 - p0 - 3 * p2 + p3) * s ** 3)


def loft(name, points, mat=None, segments=24, steps=None, cap=True, roll=0.0, parent=None, location=None, subsurf=0, shape=None):
    """A smooth organic form from a spine: limbs, bodies, trunks, tentacles, vases, horns.

    Each point is (x, y, z, radius) or (x, y, z, radius_a, radius_b) for an oval section.
    shape(u, angle) can return a radius multiplier, for ribs, flutes, or a lumpy surface.
    """
    spine = [Vector(p[:3]) for p in points]
    radii = [(p[3], p[4] if len(p) > 4 else p[3]) for p in points]
    steps = steps or max(8, (len(points) - 1) * 8)
    verts = []
    faces = []
    up = Vector((0, 0, 1)) if abs((spine[-1] - spine[0]).normalized().z) < 0.9 else Vector((1, 0, 0))
    last = len(points) - 1
    for i in range(steps + 1):
        u = i / steps
        center = _catmull(spine, u)
        tangent = (_catmull(spine, min(u + 0.005, 1)) - _catmull(spine, max(u - 0.005, 0))).normalized()
        side = up.cross(tangent)
        side = side.normalized() if side.length > 1e-5 else Vector((1, 0, 0))
        normal = tangent.cross(side).normalized()
        up = normal  # carried along the spine, so the section never flips
        f = u * last
        k = min(int(f), last - 1)
        s = f - k
        s = s * s * (3 - 2 * s)
        ra = radii[k][0] + (radii[k + 1][0] - radii[k][0]) * s
        rb = radii[k][1] + (radii[k + 1][1] - radii[k][1]) * s
        for j in range(segments):
            a = j / segments * math.tau + roll
            scale = shape(u, a) if shape else 1.0
            verts.append(center + normal * math.cos(a) * ra * scale + side * math.sin(a) * rb * scale)
        if i < steps:
            row = i * segments
            for j in range(segments):
                nxt = (j + 1) % segments
                faces.append((row + j, row + nxt, row + segments + nxt, row + segments + j))
    if cap:
        faces.append(tuple(reversed(range(segments))))
        faces.append(tuple(steps * segments + j for j in range(segments)))
    obj = mesh(name, verts, faces, mat, True, parent, location)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    if subsurf:
        mod = obj.modifiers.new('subsurf', 'SUBSURF')
        mod.levels = subsurf
        mod.render_levels = subsurf
    return obj


def lathe(name, profile, mat=None, segments=64, steps=None, parent=None, location=None, shape=None):
    """A form spun around Z from (radius, z) points: domes, vases, bottles, towers, wheels, mushroom caps.

    The profile can double back to model an underside or an inner wall. shape(u, angle) can return a
    radius multiplier, for flutes or an uneven edge.
    """
    spine = [Vector((r, 0, z)) for r, z in profile]
    steps = steps or max(16, (len(profile) - 1) * 6)
    verts = []
    faces = []
    for i in range(steps + 1):
        u = i / steps
        point = _catmull(spine, u)
        for j in range(segments):
            a = j / segments * math.tau
            radius = max(point.x, 0.0005) * (shape(u, a) if shape else 1.0)
            verts.append((math.cos(a) * radius, math.sin(a) * radius, point.z))
        if i < steps:
            row = i * segments
            for j in range(segments):
                nxt = (j + 1) % segments
                faces.append((row + j, row + nxt, row + segments + nxt, row + segments + j))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(steps * segments + j for j in range(segments)))
    obj = mesh(name, verts, faces, mat, True, parent, location)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def fbm(x, y=0.0, z=0.0, octaves=5, lacunarity=2.0, gain=0.5):
    """Layered noise from about -1 to 1: terrain, rock shapes, wobble."""
    total = 0.0
    amp = 1.0
    norm = 0.0
    p = Vector((x, y, z))
    for _ in range(octaves):
        total += noise.noise(p) * amp
        norm += amp
        amp *= gain
        p *= lacunarity
    return total / norm * 1.6


def terrain(name, size=(100, 100), resolution=300, height=None, mat=None, location=(0, 0, 0)):
    """A ground mesh. height(x, y) returns meters. Spend resolution near the camera by keeping this small."""
    nx = resolution
    ny = max(2, round(resolution * size[1] / size[0]))
    verts = []
    for j in range(ny + 1):
        y = (j / ny - 0.5) * size[1]
        for i in range(nx + 1):
            x = (i / nx - 0.5) * size[0]
            verts.append((x, y, height(x, y) if height else 0.0))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    return mesh(name, verts, faces, mat, True, None, location)


def displace(obj, amount=0.1, scale=1.0, detail=6, seed=0):
    """Roughens a mesh with noise: rock, bark, damaged metal. Subdivide first, as it moves existing vertices."""
    data = obj.data
    offset = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in data.vertices:
        v.co += v.normal * fbm(*(v.co * scale + offset), octaves=detail) * amount
    data.update()


def subdivide(obj, levels=2):
    mod = obj.modifiers.new('subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    return mod


# --- Scattering and hair ---

def library(name='library'):
    """A collection that isn't rendered directly: keeps the source objects for scatter()."""
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    bpy.context.view_layer.layer_collection.children[collection.name].exclude = True
    return collection


def _socket(sockets, name):
    return next(s for s in sockets if s.name == name and s.enabled)


def scatter(surface, collection, density=1.0, scale=(0.8, 1.2), seed=0, align=0.0, tilt=0.0, weight=None, min_distance=0.0):
    """Places many copies of a collection's objects across a surface: grass, rocks, trees, crowds, debris.

    density: copies per square meter. align: 1 follows the surface normal, 0 stands upright.
    tilt: random lean in degrees. weight(x, y, z): 0 to 1 density map, for paths and clearings.
    Copies are instanced, so hundreds of thousands fit in memory.
    """
    bpy.context.view_layer.update()
    if weight:
        values = [max(0.0, min(1.0, weight(*(surface.matrix_world @ v.co)))) for v in surface.data.vertices]
        attribute = surface.data.attributes.new('scatter_weight', 'FLOAT', 'POINT')
        attribute.data.foreach_set('value', values)

    group = bpy.data.node_groups.new(f'scatter_{collection.name}', 'GeometryNodeTree')
    group.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes = group.nodes
    wire = group.links.new
    start = nodes.new('NodeGroupInput')
    end = nodes.new('NodeGroupOutput')

    points = nodes.new('GeometryNodeDistributePointsOnFaces')
    wire(start.outputs['Geometry'], points.inputs['Mesh'])
    if min_distance > 0:
        points.distribute_method = 'POISSON'
        _socket(points.inputs, 'Distance Min').default_value = min_distance
        _socket(points.inputs, 'Density Max').default_value = density
        factor = 'Density Factor'
    else:
        _socket(points.inputs, 'Density').default_value = density
        factor = 'Density'
    _socket(points.inputs, 'Seed').default_value = seed
    if weight:
        named = nodes.new('GeometryNodeInputNamedAttribute')
        named.data_type = 'FLOAT'
        named.inputs['Name'].default_value = 'scatter_weight'
        if factor == 'Density':
            times = nodes.new('ShaderNodeMath')
            times.operation = 'MULTIPLY'
            times.inputs[1].default_value = density
            wire(named.outputs['Attribute'], times.inputs[0])
            wire(times.outputs[0], _socket(points.inputs, 'Density'))
        else:
            wire(named.outputs['Attribute'], _socket(points.inputs, factor))

    source = nodes.new('GeometryNodeCollectionInfo')
    source.inputs['Collection'].default_value = collection
    source.inputs['Separate Children'].default_value = True
    source.inputs['Reset Children'].default_value = True

    place = nodes.new('GeometryNodeInstanceOnPoints')
    wire(points.outputs['Points'], place.inputs['Points'])
    wire(source.outputs['Instances'], place.inputs['Instance'])
    place.inputs['Pick Instance'].default_value = True

    def random_value(data_type, low, high, offset):
        node = nodes.new('FunctionNodeRandomValue')
        node.data_type = data_type
        _socket(node.inputs, 'Min').default_value = low
        _socket(node.inputs, 'Max').default_value = high
        _socket(node.inputs, 'Seed').default_value = seed + offset
        return node

    wire(next(o for o in random_value('INT', 0, 100000, 1).outputs if o.enabled), place.inputs['Instance Index'])
    scale_value = random_value('FLOAT', scale[0], scale[1], 2)
    wire(next(o for o in scale_value.outputs if o.enabled), place.inputs['Scale'])

    lean = math.radians(tilt)
    angle = random_value('FLOAT_VECTOR', (-lean, -lean, 0.0), (lean, lean, math.tau), 3)
    if align > 0:
        mix = nodes.new('FunctionNodeRotateRotation')
        wire(points.outputs['Rotation'], mix.inputs['Rotation'])
        to_rotation = nodes.new('FunctionNodeEulerToRotation')
        wire(next(o for o in angle.outputs if o.enabled), to_rotation.inputs['Euler'])
        wire(to_rotation.outputs['Rotation'], mix.inputs['Rotate By'])
        wire(mix.outputs['Rotation'], place.inputs['Rotation'])
    else:
        wire(next(o for o in angle.outputs if o.enabled), place.inputs['Rotation'])

    join = nodes.new('GeometryNodeJoinGeometry')
    wire(start.outputs['Geometry'], join.inputs[0])
    wire(place.outputs['Instances'], join.inputs[0])
    wire(join.outputs[0], end.inputs['Geometry'])

    modifier = surface.modifiers.new('scatter', 'NODES')
    modifier.node_group = group
    return modifier


def hair(obj, count=2000, length=0.1, mat=None, children=20, root=0.004, tip=0.0005, messy=0.05, clump=0.3, curl=0.0, seed=0, weight=None):
    """Grows real strands on a mesh: fur, grass tufts, moss, carpet. Follows a rig if the mesh has one.

    Rendered strands = count * children. Roots and tips are in meters. Hair costs GPU memory fast:
    about 1 million strands is tested on 6 GB. weight(x, y, z): 0 to 1 density map.
    """
    if mat:
        if mat.name not in obj.data.materials:
            obj.data.materials.append(mat)
    modifier = obj.modifiers.new(f'hair{len(obj.modifiers)}', 'PARTICLE_SYSTEM')
    system = modifier.particle_system
    settings = system.settings
    settings.type = 'HAIR'
    settings.count = count
    settings.hair_length = length
    settings.hair_step = 5
    settings.render_step = 3
    settings.display_step = 2
    settings.emit_from = 'FACE'
    settings.use_even_distribution = True
    settings.child_type = 'INTERPOLATED' if children else 'NONE'
    settings.child_percent = max(1, children // 4)
    settings.rendered_child_count = children
    settings.child_length = 1.0
    settings.clump_factor = clump
    settings.roughness_2 = messy * length
    settings.roughness_2_size = 0.2
    settings.roughness_1 = messy * length * 0.5
    settings.roughness_1_size = 0.05
    settings.kink = 'CURL' if curl else 'NO'
    if curl:
        settings.kink_amplitude = curl
        settings.kink_frequency = 3
    settings.factor_random = messy * length * 2
    settings.normal_factor = length
    settings.radius_scale = 1.0
    settings.root_radius = root
    settings.tip_radius = tip
    settings.use_close_tip = True
    settings.shape = -0.2
    if mat:
        settings.material = list(obj.data.materials).index(mat) + 1
    system.seed = seed
    if weight:
        bpy.context.view_layer.update()
        group = obj.vertex_groups.new(name=f'hair_{modifier.name}')
        for v in obj.data.vertices:
            group.add([v.index], max(0.0, min(1.0, weight(*(obj.matrix_world @ v.co)))), 'REPLACE')
        system.vertex_group_density = group.name
    return system


# --- Rigging ---

def rig(name, bones, meshes=(), sharpness=4.0, parent=None):
    """An armature for anything that bends: creatures, people, plants, machines, cloth flags.

    bones: [(name, parent_or_None, head_xyz, tail_xyz), ...] in world space. Each mesh is skinned by
    distance to the bones, so no weight painting is needed. Higher sharpness = crisper joints.
    Keep the meshes at the world origin with no rotation before rigging them.
    """
    bpy.context.view_layer.update()  # matrix_world is stale until this runs, and the weights depend on it
    data = bpy.data.armatures.new(name)
    arm = link(bpy.data.objects.new(name, data), parent=parent)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    edit = {}
    for bone_name, parent_name, head, tail in bones:
        bone = data.edit_bones.new(bone_name)
        bone.head = head
        bone.tail = tail
        if parent_name:
            bone.parent = edit[parent_name]
        edit[bone_name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')

    heads = np.array([b[2] for b in bones], dtype=np.float64)
    tails = np.array([b[3] for b in bones], dtype=np.float64)
    axes = tails - heads
    lengths = np.maximum((axes ** 2).sum(axis=1), 1e-9)
    for obj in meshes:
        count = len(obj.data.vertices)
        co = np.empty(count * 3)
        obj.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        matrix = np.array(obj.matrix_world)
        co = co @ matrix[:3, :3].T + matrix[:3, 3]
        offset = co[:, None, :] - heads[None, :, :]
        along = np.clip((offset * axes[None, :, :]).sum(axis=2) / lengths[None, :], 0, 1)
        nearest = heads[None, :, :] + along[:, :, None] * axes[None, :, :]
        distance = np.sqrt(((co[:, None, :] - nearest) ** 2).sum(axis=2))
        weights = 1.0 / np.maximum(distance, 1e-4) ** sharpness
        weights /= weights.sum(axis=1, keepdims=True)
        for index, bone in enumerate(bones):
            group = obj.vertex_groups.new(name=bone[0])
            for value, ids in _weight_batches(weights[:, index]):
                group.add(ids, value, 'REPLACE')
        modifier = obj.modifiers.new('rig', 'ARMATURE')
        modifier.object = arm
        # Before anything that reads the deformed mesh, and after any subdivision only if it is already there.
        while obj.modifiers.find(modifier.name) > 0:
            obj.modifiers.move(obj.modifiers.find(modifier.name), obj.modifiers.find(modifier.name) - 1)
    return arm


def _weight_batches(values):
    # Rounding lets vertices with equal weights share one call, which is far faster than one per vertex.
    rounded = np.round(values, 3)
    for value in np.unique(rounded):
        if value > 0:
            yield float(value), np.nonzero(rounded == value)[0].tolist()


def pose(arm, keys):
    """Keys bone rotations: pose(arm, {'neck': [(0, (0, 0, 0)), (1, (30, 0, 0))]}).

    Angles are degrees around the bone's own axes, and Y runs along the bone. Check the result in a frame,
    because which way X and Z bend depends on the bone's direction.
    """
    for bone_name, frames in keys.items():
        bone = arm.pose.bones[bone_name]
        bone.rotation_mode = 'XYZ'
        for t, value in frames:
            bone.rotation_euler = tuple(math.radians(v) for v in value)
            bone.keyframe_insert('rotation_euler', frame=frame(t))


def text(body, size=1.0, mat=None, location=(0, 0, 0), rotation=(90, 0, 0), extrude=0.02, bevel=0.005, align='CENTER'):
    """3D text, facing -Y by default. Keep spelling exactly as the prompt gives it."""
    data = bpy.data.curves.new('text', 'FONT')
    data.body = body
    data.size = size
    data.extrude = extrude
    data.bevel_depth = bevel
    data.align_x = align
    data.align_y = 'CENTER'
    obj = link(bpy.data.objects.new('text', data))
    obj.location = location
    obj.rotation_euler = tuple(math.radians(v) for v in rotation)
    if mat:
        data.materials.append(mat)
    return obj


def rng(seed=0):
    """A separate seeded random generator, so changing one part of a scene doesn't reshuffle the others."""
    return random.Random(seed)
