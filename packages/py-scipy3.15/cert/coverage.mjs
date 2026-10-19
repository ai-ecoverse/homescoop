// homescoop#1242: the scipy areas the other specs don't reach. Each value is
// computed on wasm and compared with what CPython/scipy give natively.
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import io, json, os, tempfile
import numpy as np
from scipy import spatial, interpolate, ndimage, integrate, cluster, sparse, stats
import scipy.io as sio
from scipy.io import wavfile, arff
from scipy.stats import sampling
from scipy.sparse import csgraph
out = {}
pts = np.array([[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]], float)
out["hull"] = sorted(spatial.ConvexHull(pts).vertices.tolist())
out["delaunay"] = len(spatial.Delaunay(pts).simplices)
out["voronoi"] = len(spatial.Voronoi(pts).vertices)
d, i = spatial.cKDTree(pts).query([0.9, 0.1]); out["kdtree"] = [int(i), round(float(d), 6)]
out["pdist"] = round(float(spatial.distance.pdist(pts[:2])[0]), 6)
x = np.linspace(0, 2 * np.pi, 20)
tck = interpolate.splrep(x, np.sin(x)); out["splev"] = round(float(interpolate.splev(np.pi / 2, tck)), 3)
gx, gy = np.mgrid[0:1:5j, 0:1:5j]
tb = interpolate.bisplrep(gx.ravel(), gy.ravel(), (gx + gy).ravel(), kx=1, ky=1); out["bisplev"] = round(float(interpolate.bisplev(0.5, 0.5, tb)), 6)
out["griddata"] = round(float(interpolate.griddata(pts, pts[:, 0] + pts[:, 1], [(0.25, 0.25)])[0]), 6)
out["rbf"] = round(float(interpolate.RBFInterpolator(pts, pts[:, 0] * 2)([[0.5, 0.5]])[0]), 6)
img = np.zeros((7, 7)); img[1:3, 1:3] = 1; img[4:6, 4:6] = 1
out["label"] = int(ndimage.label(img)[1])
out["gaussian"] = round(float(ndimage.gaussian_filter(np.eye(5), 1).sum()), 6)
out["odeint"] = round(float(integrate.odeint(lambda y, t: -y, 1.0, [0, 1])[-1, 0]), 6)
out["lsoda"] = round(float(integrate.solve_ivp(lambda t, y: -y, (0, 1), [1.0], method="LSODA", rtol=1e-9, atol=1e-12).y[0, -1]), 6)
r = integrate.ode(lambda t, y: -y).set_integrator("vode"); r.set_initial_value([1.0], 0); out["vode"] = round(float(r.integrate(1.0)[0]), 4)
bvp = integrate.solve_bvp(lambda x, y: np.vstack([y[1], -y[0]]), lambda ya, yb: np.array([ya[0], yb[0] - 1]), np.linspace(0, np.pi / 2, 5), np.zeros((2, 5)))
out["bvp"] = [bool(bvp.success), round(float(bvp.sol(np.pi / 4)[0]), 4)]
t = tempfile.mkdtemp()
sio.savemat(os.path.join(t, "a.mat"), {"m": np.arange(6).reshape(2, 3)}); out["mat"] = sio.loadmat(os.path.join(t, "a.mat"))["m"].tolist()
wavfile.write(os.path.join(t, "a.wav"), 8000, np.array([0, 1000, -1000], np.int16)); out["wav"] = [wavfile.read(os.path.join(t, "a.wav"))[0], wavfile.read(os.path.join(t, "a.wav"))[1].tolist()]
b = io.BytesIO(); sio.mmwrite(b, sparse.coo_array(np.eye(3))); b.seek(0); out["mm"] = int(sio.mmread(b).nnz)
data, meta = arff.loadarff(io.StringIO("@relation r\n@attribute x numeric\n@data\n1\n2\n")); out["arff"] = data["x"].tolist()
with sio.FortranFile(os.path.join(t, "f.bin"), "w") as f: f.write_record(np.arange(3, dtype=np.int32))
with sio.FortranFile(os.path.join(t, "f.bin"), "r") as f: out["fortranfile"] = f.read_ints(np.int32).tolist()
_, lab = cluster.vq.kmeans2(np.array([[0.0], [0.1], [10.0], [10.1]]), np.array([[0.0], [10.0]]), minit="matrix"); out["kmeans2"] = lab.tolist()
fc = cluster.hierarchy.fcluster(cluster.hierarchy.linkage([[0], [0.1], [10], [10.1]], "single"), 2, "maxclust").tolist(); out["linkage"] = [fc[0] == fc[1], fc[2] == fc[3], fc[0] != fc[2]]
rng = np.random.default_rng(1)
s = sampling.NumericalInversePolynomial(stats.norm(), random_state=rng).rvs(2000); out["unuran"] = bool(abs(s.mean()) < 0.1 and abs(s.std() - 1) < 0.1)
g = sparse.csr_matrix(np.array([[0, 1, 4], [1, 0, 2], [4, 2, 0]], float))
out["shortest"] = csgraph.shortest_path(g)[0].tolist()
out["mst"] = float(csgraph.minimum_spanning_tree(g).sum())
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await pythonUnderTest(ctx);
  await write('/tmp/scipy_coverage.py', SCRIPT);
  const r = await run(['python3', '/tmp/scipy_coverage.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  const want = {
    hull: [0, 1, 2, 3], delaunay: 4, voronoi: 4, kdtree: [1, 0.141421], pdist: 1,
    splev: 1, bisplev: 1, griddata: 0.5, rbf: 1, label: 2, gaussian: 5,
    odeint: 0.367879, lsoda: 0.367879, vode: 0.3679, bvp: [true, 0.7071],
    mat: [[0, 1, 2], [3, 4, 5]], wav: [8000, [0, 1000, -1000]], mm: 3, arff: [1, 2], fortranfile: [0, 1, 2],
    kmeans2: [0, 0, 1, 1], linkage: [true, true, true], unuran: true, shortest: [0, 1, 3], mst: 3,
  };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(out[k], v, `${k}: ${o}`);
  console.log(`coverage (#1242): spatial (Qhull hull/Delaunay/Voronoi, cKDTree, pdist), interpolate (FITPACK splrep/bisplrep, griddata, RBF), ndimage, integrate (odeint, LSODA, vode, solve_bvp), io (savemat/loadmat, wavfile, mmio, arff, FortranFile), cluster (kmeans2, linkage), stats.sampling (UNU.RAN), csgraph: ${o}`);
}
