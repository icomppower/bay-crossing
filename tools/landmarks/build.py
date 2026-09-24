# Offline landmark builder (Blender 5.2, headless): procedural meshes from published dimensions and the
# prepared footprints (tools/landmarks/prepare.mjs), exported as three LOD GLBs per landmark.
#   blender -b --factory-startup --python tools/landmarks/build.py -- <input.json> <out_dir>
# Blender axes: X east, Y north, Z up (the glTF exporter turns this into x east, y up, z south).
# Sources for the dimensions are cited in CREDITS.md (Landmarks).
import bpy, json, math, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
INP, OUT = args[0], args[1]
data = json.load(open(INP))
os.makedirs(OUT, exist_ok=True)

def srgb(r, g, b):
    f = lambda c: (c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

PALETTE = {  # name: (sRGB, roughness, metallic)
    'international_orange': ((192, 54, 44), 0.55, 0.2),   # Golden Gate Bridge's official colour
    'concrete': ((188, 184, 176), 0.9, 0.0),
    'stone': ((218, 209, 190), 0.85, 0.0),
    'roof': ((104, 112, 106), 0.7, 0.0),
    'white': ((232, 230, 223), 0.55, 0.0),
    'dark': ((70, 72, 74), 0.6, 0.3),
}
MATS = {}

def make_materials():
    MATS.clear()
    for name, (rgb, rough, metal) in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = srgb(*rgb)
        p.inputs['Roughness'].default_value = rough
        p.inputs['Metallic'].default_value = metal
        MATS[name] = m

def area(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2
def norm(v): l = math.sqrt(sum(c * c for c in v)) or 1; return tuple(c / l for c in v)
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def bl(p): return (p[0], -p[1])  # local (x east, z south) -> Blender (x east, y north)
def centroid(r): return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))
def pca_angle(ring):
    cx, cy = centroid(ring)
    sxx = sum((p[0] - cx) ** 2 for p in ring); syy = sum((p[1] - cy) ** 2 for p in ring); sxy = sum((p[0] - cx) * (p[1] - cy) for p in ring)
    return 0.5 * math.atan2(2 * sxy, sxx - syy)

class Builder:
    def __init__(self): self.parts = {}
    def add(self, material, verts, faces):
        v, f = self.parts.setdefault(material, ([], []))
        o = len(v); v.extend(verts); f.extend([tuple(i + o for i in face) for face in faces])
    def box(self, m, cx, cy, z0, sx, sy, h, ang=0.0, top_scale=1.0):
        c, s = math.cos(ang), math.sin(ang)
        pts = []
        for z, k in ((z0, 1.0), (z0 + h, top_scale)):
            for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                x, y = dx * sx / 2 * k, dy * sy / 2 * k
                pts.append((cx + x * c - y * s, cy + x * s + y * c, z))
        self.add(m, pts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    def prism(self, m, ring, z0, z1, scale_top=1.0, centre=(0, 0)):
        if area(ring) < 0: ring = ring[::-1]
        n = len(ring); cx, cy = centre
        bot = [(x, y, z0) for x, y in ring]
        top = [(cx + (x - cx) * scale_top, cy + (y - cy) * scale_top, z1) for x, y in ring]
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n, 2 * n))]
        self.add(m, bot + top, faces)
    def cylinder(self, m, cx, cy, r0, r1, z0, z1, seg, flute=0.0):
        ring0, ring1 = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            k = 1 - (flute if (flute and i % 2) else 0)
            ring0.append((cx + math.cos(a) * r0 * k, cy + math.sin(a) * r0 * k, z0))
            ring1.append((cx + math.cos(a) * r1 * k, cy + math.sin(a) * r1 * k, z1))
        faces = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)] + [tuple(range(seg, 2 * seg))]
        self.add(m, ring0 + ring1, faces)
    def tube(self, m, pts, r, sides):
        verts, faces = [], []
        for i, p in enumerate(pts):
            q = pts[min(i + 1, len(pts) - 1)]; o = pts[max(i - 1, 0)]
            d = norm((q[0] - o[0], q[1] - o[1], q[2] - o[2]))
            u = norm(cross(d, (0, 0, 1))) if abs(d[2]) < 0.99 else (1, 0, 0)
            w = cross(u, d)
            for k in range(sides):
                a = 2 * math.pi * k / sides
                verts.append(tuple(p[j] + r * (math.cos(a) * u[j] + math.sin(a) * w[j]) for j in range(3)))
        for i in range(len(pts) - 1):
            for k in range(sides):
                a0, a1 = i * sides + k, i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides))
        self.add(m, verts, faces)
    def build(self, name, location):
        for mname, (v, f) in sorted(self.parts.items()):
            me = bpy.data.meshes.new(f'{name}_{mname}')
            me.from_pydata(v, [], f)
            me.validate(); me.update()
            for poly in me.polygons: poly.use_smooth = False
            me.materials.append(MATS[mname])
            ob = bpy.data.objects.new(f'{name}_{mname}', me)
            ob.location = location
            bpy.context.scene.collection.objects.link(ob)

# ------------------------------------------------------------------------------------------- the landmarks

def golden_gate(L, lod):
    # Golden Gate Bridge (Golden Gate Bridge, Highway and Transportation District, "Bridge Design & Construction
    # Statistics"): main span 4,200 ft (1,280 m), side spans 1,125 ft (343 m), towers 746 ft (227 m) above water,
    # clearance 220 ft (67 m), deck 90 ft (27.4 m) wide, truss 25 ft (7.6 m) deep, cables 90 ft apart,
    # suspenders every 50 ft (15.24 m). Tower positions from OSM (landmarks-osm.json).
    B = Builder()
    (sx, sz), (nx, nz) = L['towers']
    ax, ay = norm((nx - sx, -(nz - sz), 0))[:2]
    px, py = -ay, ax
    half = math.hypot(nx - sx, nz - sz) / 2
    side = 343.0
    at = lambda s, v, z: (ax * s + px * v, ay * s + py * v, z)
    ang = math.atan2(ay, ax)
    DECK, TOWER, SADDLE, CV = 67.0, 227.0, 220.0, 13.7
    for s in (-half, half):
        for v in (-CV, CV):
            x, y, _ = at(s, v, 0)
            B.box('international_orange', x, y, 0, 10 if lod < 2 else 9, 16 if lod < 2 else 14, TOWER, ang, 0.65)
        x, y, _ = at(s, 0, 0)
        B.box('concrete', x, y, -6, 48, 26, 12, ang)
        if lod < 2:
            for zc in ([72, 110, 148, 186, 214] if lod == 0 else [110, 186, 214]):
                B.box('international_orange', x, y, zc - 4, 6, 2 * CV, 8, ang)
    total = 2 * (half + side)
    segs = 24 if lod == 0 else 8 if lod == 1 else 2
    for i in range(segs):
        s0 = -half - side + total * i / segs; s1 = s0 + total / segs
        x, y, _ = at((s0 + s1) / 2, 0, 0)
        B.box('international_orange', x, y, DECK - 7.6, total / segs + 0.05, 27.4, 7.6, ang)
        if lod == 0: B.box('dark', x, y, DECK, total / segs + 0.05, 25.0, 0.3, ang)
    def cable_z(s):
        if abs(s) <= half: return DECK + 3 + (SADDLE - DECK - 3) * (s / half) ** 2
        t = (abs(s) - half) / side
        return SADDLE + (DECK + 2 - SADDLE) * t - 18 * math.sin(math.pi * t)
    n = 96 if lod == 0 else 32 if lod == 1 else 10
    sides = 8 if lod == 0 else 4 if lod == 1 else 3
    for v in (-CV, CV):
        pts = [at(-half - side + total * i / n, v, cable_z(-half - side + total * i / n)) for i in range(n + 1)]
        B.tube('international_orange', pts, 0.46 if lod < 2 else 1.2, sides)
        if lod == 0:
            s = -half - side + 7.62
            while s < half + side:
                if abs(abs(s) - half) > 8:
                    x, y, _ = at(s, v, 0)
                    B.box('international_orange', x, y, DECK, 0.3, 0.3, cable_z(s) - DECK, ang)
                s += 15.24
    return B

def ferry_building(L, lod):
    # Ferry Building (1898): 660 ft (201 m) long shed from the SF footprint, clock tower 245 ft (74.7 m).
    B = Builder()
    ring = [bl(p) for p in L['footprint']]
    g = L['ground']
    ang = pca_angle(ring)
    B.prism('stone', ring, g - 1, 16.0)
    if lod == 0: B.prism('roof', ring, 16.0, 19.5, 0.94, centroid(ring))
    stages = [(g - 1, 44, 14.5), (44, 58, 12.5), (58, 66, 10.0)] if lod < 2 else [(g - 1, 66, 13)]
    for z0, z1, w in stages: B.box('stone', 0, 0, z0, w, w, z1 - z0, ang)
    B.box('roof', 0, 0, 66, 10.0, 10.0, 8.7, ang, 0.05)
    if lod == 0: B.box('dark', 0, 0, 50.5, 12.8, 12.8, 1.6, ang)
    return B

def coit_tower(L, lod):
    # Coit Tower (1933): fluted concrete column, 210 ft (64 m), footprint from OSM.
    B = Builder()
    ring = [bl(p) for p in L['footprint']]
    r = sum(math.hypot(x, y) for x, y in ring) / len(ring)
    g, h = L['ground'], L.get('height') or 64.0
    seg = 32 if lod == 0 else 12 if lod == 1 else 8
    B.cylinder('stone', 0, 0, r, r * 0.97, g - 1, g + h - 6, seg, 0.05 if lod == 0 else 0)
    B.cylinder('stone', 0, 0, r * 1.04, r * 1.02, g + h - 6, g + h, seg)
    if lod == 0: B.box('stone', 0, 0, g - 1, r * 3.2, r * 2.4, 8, 0.0)
    return B

def transamerica(L, lod):
    # Transamerica Pyramid (1972): 853 ft (260 m); 175 ft (53 m) square base tapering to the spire (the top
    # 212 ft is spire); elevator and stair wings on the east and west faces, floors 29-45. Footprint from OSM.
    B = Builder()
    ring = [bl(p) for p in L['footprint']]
    ang = pca_angle(ring)
    c, s = math.cos(-ang), math.sin(-ang)
    xs = [p[0] * c - p[1] * s for p in ring]; ys = [p[0] * s + p[1] * c for p in ring]
    side = min(max(xs) - min(xs), max(ys) - min(ys))
    g, top = L['ground'], L.get('height') or 260.0
    body = top - 64.6
    k = 14.0 / side
    B.box('white', 0, 0, g - 1, side, side, body - g + 1, ang, k)
    B.box('white', 0, 0, body, 14.0, 14.0, top - body, ang, 0.04)
    if lod < 2:
        z0, z1 = 110.0, 180.0
        hw = side / 2 * (1 - (1 - k) * (z0 - g) / (body - g))
        for sgn in (-1, 1):
            wx, wy = sgn * (hw + 2.0) * math.cos(ang), sgn * (hw + 2.0) * math.sin(ang)
            B.box('white', wx, wy, z0, 6.0, side * 0.3, z1 - z0, ang, 0.8)
    return B

def alcatraz(L, lod):
    # Alcatraz: OSM building footprints on the island (cellhouse, water tower, lighthouse 84 ft / 26 m, ...),
    # heights from OSM tags where present, else by kind.
    B = Builder()
    blds = L['buildings']
    if lod == 2: blds = sorted(blds, key=lambda b: -abs(area([bl(p) for p in b['ring']])))[:6]
    for b in blds:
        ring = [bl(p) for p in b['ring']]
        if len(ring) < 3: continue
        g, kind, name = b['ground'], b['kind'], b['name']
        if kind == 'lighthouse':
            r = math.sqrt(abs(area(ring)) / math.pi); h = b['height'] or 26
            B.cylinder('white', *centroid(ring), r, r * 0.7, g - 1, g + h - 3, 8 if lod < 2 else 6)
            B.cylinder('dark', *centroid(ring), r * 0.75, r * 0.75, g + h - 3, g + h, 8)
            continue
        h = b['height'] or (b['levels'] * 3.5 if b['levels'] else None) or \
            {'water_tower': 28, 'chimney': 24, 'tower': 12, 'ruins': 5}.get(kind) or (16 if name == 'Main Prison' else 8)
        B.prism('white' if name == 'Main Prison' else 'concrete', ring, g - 1, g + h)
    return B

BUILDERS = {'golden-gate-bridge': golden_gate, 'ferry-building': ferry_building, 'coit-tower': coit_tower,
            'transamerica-pyramid': transamerica, 'alcatraz': alcatraz}

for L in data['landmarks']:
    for lod in (0, 1, 2):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        make_materials()
        B = BUILDERS[L['slug']](L, lod)
        ax, az = L['anchor']
        B.build(f"{L['slug']}_lod{lod}", (ax, -az, 0.0))
        path = os.path.join(OUT, f"{L['slug']}_lod{lod}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  export_materials='EXPORT', export_texcoords=False, export_normals=True,
                                  export_extras=False, export_cameras=False, export_lights=False, use_selection=False)
        print('wrote', path)
