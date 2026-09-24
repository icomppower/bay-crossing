# BLOCKED — G0 Data check (2026-09-24)

## What

The DTM half of G0 works. The 3D-buildings half does not: no LandsD 3D Spatial Data tile in **FBX or
VRML** (the formats D4 names) can be downloaded by script.

## Why (what was tried)

1. **DTM: OK.** `https://www.landsd.gov.hk/landsd_psi_data/SMO/data/Whole_HK_DTM_5m.zip` (28.7 MB zip →
   302 MB ArcInfo ASCII grid, whole territory). Downloaded to `data/raw/dtm/` (gitignored).
2. **3D-BIT00 FBX/VRML: not downloadable.** HK Map Service lists TST as 1:1000 sheet `T11-SW-4D`
   (HK1980 E 835250–836000, N 816800–817400, dated 2025-10-30); Central pier is `T11-SW-9A`. Formats
   3DS/FBX/MAX/VRML are flagged open data. Its own anonymous download-list flow
   (`OneStopSystem/downloadList/addItem` → `getDownloadLink`) returns
   `https://open.hkmapservice.gov.hk/OpenData/productView?productName=3D-BIT00&sheetName=T11-SW-4D&productFormat=FBX`,
   and that page says **"Product not found"**. The OpenData queue API (`/OpenData/api/download/requestQueue`)
   returns `status -2 … is not found` for every 3D-BIT00 sheet and format tried (T11-SW-4D, T11-SW-4C,
   T11-SW-9A, T11-NW-24B, T1-SE-19D × FBX/VRML/3DS/MAX, with and without a revision date). The 2D product
   iB1000 for the same sheet queues fine, so the flow itself works; the 3D files just aren't on that server.
   `directDownload` for 3D-BIT00 redirects to an internal government hostname (`hkms.landsd.hksarg`).
3. **CSDI portal file downloads: blocked.** `portal.csdi.gov.hk/csdi-webpage/download/common/…` returns 403
   "The request is blocked". CSDI file downloads sit behind its sign-in.
4. **What does work: the LandsD 3D Tiles API.**
   `https://data.map.gov.hk/api/3d-data/3dsd/WGS84/building/tileset.json?key=3967f8f365694e0798af3e7678509421`
   (the key is the example printed in the official API docs). It covers the whole territory (12.2 M
   triangles, 218,927 components). I walked the tree to the leaf over the TST pier and fetched it: a `b3dm`
   holding a textured glTF (KHR_texture_basisu). It's the same 3D Spatial Data, served as Cesium 3D Tiles in
   WGS84/ECEF.

Two §7 stop rules apply: the FBX/VRML files need a manual download (or a login), and the only scriptable
source would change **D4** ("Convert via FBX or VRML with headless Blender").

## The one question

**May I use the LandsD 3D Tiles API as the building source instead of FBX/VRML (amending D4), or will you
download the FBX zips for sheets `T11-SW-4D` and `T11-SW-9A` into `data/raw/3d/` yourself?**

With the 3D Tiles API, `b3dm` → glTF would still pass through headless Blender into cached GLB. It's fully
scripted, so the G2b byte-identical-rerun gate can re-fetch from source. I recommend it. Caveat: it runs on the
documentation's example key; LandsD issues its own keys via 3dmap@landsd.gov.hk if that key is ever revoked.
