import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// 로컬 의존성
import * as GS3D from "@mkkellogg/gaussian-splats-3d";
import * as THREE from "three";

// 초기 카메라 롤(상하) 반전 적용 여부
let gFlipRoll = true;


// 카메라 up 벡터 세팅
function setCameraUp(viewer, up = "Y") {
  const cam = viewer?.camera;
  if (!cam) return;
  if (up === "Z") cam.up.set(0, 0, 1);
  else if (up === "X") cam.up.set(1, 0, 0);
  else cam.up.set(0, 1, 0); // Y-up 기본
  cam.updateProjectionMatrix?.();
}

// 씬 회전 + 카메라 up 맞춤 + 프레이밍
function applyOrientation(viewer, THREE, up = "Y") {
  const s = viewer?.world?.scene;
  if (!s) return;

  // 회전 초기화 후 축 전환
  s.rotation.set(0, 0, 0);
  if (up === "Z") s.rotation.x = -Math.PI / 2;     // Z-up → Y-up로 눕히기
  if (up === "X") s.rotation.z = Math.PI / 2;      // 필요 시 X-up도 대비

  // 카메라 up 벡터를 먼저 반영
  setCameraUp(viewer, up);

  // up 축에 맞춰 카메라를 다시 배치(프레이밍)
  fitCameraToScene(viewer, THREE);
  requestAnimationFrame(() => fitCameraToScene(viewer, THREE));
}



/** 파일명/URL에서 포맷 추정 */
function guessFormat(nameOrUrl) {
  const s = (nameOrUrl || "").toLowerCase();
  if (s.endsWith(".ksplat")) return GS3D.SceneFormat.KSplat;
  if (s.endsWith(".splat")) return GS3D.SceneFormat.Splat;
  if (s.endsWith(".ply")) return GS3D.SceneFormat.Ply;
  return undefined;
}

function getSceneBounds(viewer, THREElib) {
  const scene = viewer?.world?.scene;
  if (!scene) return null;
  const box = new THREElib.Box3();
  scene.traverse((obj) => {
    try {
      if (obj.geometry) {
        // geometry의 boundingBox가 없으면 계산
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox?.();
        const bb = obj.geometry.boundingBox
          ? obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld)
          : new THREElib.Box3().setFromObject(obj);
        if (isFinite(bb.min.x) && isFinite(bb.max.x)) box.union(bb);
      } else {
        const bb = new THREElib.Box3().setFromObject(obj);
        if (isFinite(bb.min.x) && isFinite(bb.max.x)) box.union(bb);
      }
    } catch { }
  });
  const center = new THREElib.Vector3(), size = new THREElib.Vector3();
  if (box.isEmpty()) return { box, center, size, diag: 0 };
  box.getCenter(center); box.getSize(size);
  return { box, center, size, diag: size.length() };
}


/** 씬 경계에 맞춰 카메라 자동 프레이밍 */
/** 씬 경계에 맞춰 카메라 자동 프레이밍(로딩 완료될 때까지 재시도) */
function fitCameraToScene(viewer, THREElib, tries = 0) {
  if (!viewer) return;
  const b = getSceneBounds(viewer, THREElib);
  if (!b || b.diag === 0) {
    if (tries < 30) {
      return requestAnimationFrame(() => fitCameraToScene(viewer, THREElib, tries + 1));
    }
    // 최종 폴백: 눈에 띄게 멀리서 원점 바라보기
    viewer.setCameraLookAt({ position: [3, 2, 3], target: [0, 0, 0] });
    // 폴백에서도 필요 시 상하 반전 적용
    try {
      const cam = viewer.camera;
      if (gFlipRoll && cam?.rotateZ) { cam.rotateZ(Math.PI); cam.updateProjectionMatrix?.(); }
    } catch {}
    return;
  }

  const maxDim = Math.max(b.size.x, b.size.y, b.size.z);
  const cam = viewer.camera;
  const fov = ((cam?.fov ?? 50) * Math.PI) / 180;
  const dist = (maxDim * 1.2) / (2 * Math.tan(fov / 2));

  // 카메라 up 축에 따라 보기 방향 선택
  let dir;
  // 초기 시점 180° 반전 이슈 보정을 위해, up 축과 무관하게 동일한 사선 시점 사용
  dir = new THREElib.Vector3(-0.9, 0.6, -0.9).normalize();
  const pos = b.center.clone().addScaledVector(dir, dist * 2.0);

  if (cam) {
    cam.fov = 45;                                  // 과한 광각 방지
    cam.near = Math.max(0.01, dist * 0.001);
    cam.far = Math.max(cam.near + 1, dist * 20);
    cam.updateProjectionMatrix?.();
  }
  viewer.setCameraLookAt({ position: pos.toArray(), target: b.center.toArray() });
  // 초기 프레이밍 후 상하(roll) 반전 필요 시 적용
  try {
    if (gFlipRoll && cam?.rotateZ) { cam.rotateZ(Math.PI); cam.updateProjectionMatrix?.(); }
  } catch {}
  try { viewer.world.renderer.setClearColor(0xf5f7fb, 1); } catch { }
}



export default function App() {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const hitRef = useRef(null);
  const viewerRef = useRef(null);

  const [sceneUrl, setSceneUrl] = useState("");
  const [sceneName, setSceneName] = useState("No scene loaded");
  const [isLoadingScene, setIsLoadingScene] = useState(false);
  const [error, setError] = useState("");

  // 위험 오버레이(데모)
  const [showHazard, setShowHazard] = useState(true);
  const [hazardOpacity, setHazardOpacity] = useState(0.28);
  const [hazardLevel, setHazardLevel] = useState("mid"); // low|mid|high

  // 수위 배지(목업)
  const [gaugeLevel, setGaugeLevel] = useState("경계");
  const gaugeClass = useMemo(
    () =>
    ({
      정상: "badge green",
      주의: "badge amber",
      경계: "badge orange",
      심각: "badge red",
    }[gaugeLevel]),
    [gaugeLevel]
  );

  // 제보 핀(로컬 상태)
  const [pins, setPins] = useState([]);
  const [pinMode, setPinMode] = useState(false);
  const [draftPin, setDraftPin] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);


  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return; // 입력창은 무시
      const k = e.key.toLowerCase();
      if (k === "y") applyOrientation(viewerRef.current, THREE, "Y");
      if (k === "z") applyOrientation(viewerRef.current, THREE, "Z");
      if (k === "r") fitCameraToScene(viewerRef.current, THREE);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 폼 입력/모달 열림 시 뷰어의 키보드 입력(WASD/Arrow/스페이스/Y/Z/R) 차단
  useEffect(() => {
    const blockKeys = new Set([
      "w","a","s","d",
      "arrowup","arrowdown","arrowleft","arrowright",
      " ", // space
      "y","z","r",
    ]);
    const captureBlocker = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const isFormEl = tag === "input" || tag === "textarea" || tag === "select";
      if (showPinModal || isFormEl) {
        const k = (e.key || "").toLowerCase();
        if (blockKeys.has(k)) {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
          else e.stopPropagation();
        }
      }
    };
    window.addEventListener("keydown", captureBlocker, true); // capture 단계
    window.addEventListener("keyup", captureBlocker, true);
    return () => {
      window.removeEventListener("keydown", captureBlocker, true);
      window.removeEventListener("keyup", captureBlocker, true);
    };
  }, [showPinModal]);
  // --- 뷰어 초기화 ---
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Dev 서버(npm start)에서는 crossOriginIsolated가 아니므로 SAB 비활성화
    const viewer = new GS3D.Viewer({
      rootElement: containerRef.current,
      ...(window.crossOriginIsolated
        ? {}
        : { sharedMemoryForWorkers: false, gpuAcceleratedSort: false }),
    });

    viewerRef.current = viewer;
    try {
      viewer.setCameraLookAt({ position: [-2.2, 1.8, -1.6], target: [0, 0, 0] });
      // 초기 화면에서도 상하(roll) 반전 적용
      if (gFlipRoll && viewer.camera?.rotateZ) {
        viewer.camera.rotateZ(Math.PI);
        viewer.camera.updateProjectionMatrix?.();
      }
    } catch { }
    viewer.start();

    const onResize = () => drawOverlay();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { viewer.dispose?.(); } catch { }
      viewerRef.current = null;
    };
  }, []);

  // --- 캔버스 오버레이 그리기(위험 사각형 + 핀) ---
  function drawOverlay() {
    const cvs = overlayRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const wrap = cvs.parentElement;
    const { width, height } = wrap.getBoundingClientRect();
    cvs.width = Math.max(1, Math.floor(width));
    cvs.height = Math.max(1, Math.floor(height));
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // 위험 사각형(데모)
    if (showHazard) {
      const w = Math.min(cvs.width * 0.48, 560);
      const h = Math.min(cvs.height * 0.32, 300);
      const x = cvs.width * 0.5 - w / 2;
      const y = cvs.height * 0.68 - h / 2;
      const color =
        hazardLevel === "low"
          ? [153, 204, 255]
          : hazardLevel === "high"
            ? [0, 17, 170]
            : [51, 102, 255]; // mid
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${hazardOpacity})`;
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${Math.min(
        0.6,
        hazardOpacity + 0.2
      )})`;
      ctx.strokeRect(x, y, w, h);
    }

    // 핀
    pins.forEach((p) => {
      const px = p.x * cvs.width;
      const py = p.y * cvs.height;
      const color =
        p.type === "침수 높이"
          ? "#2563eb"
          : p.type === "통행 곤란"
            ? "#f97316"
            : "#10b981";
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  useEffect(() => {
    drawOverlay();
  }, [showHazard, hazardOpacity, hazardLevel, pins]);

  // --- 씬 로딩 ---
  async function loadScene(url, format) {
    if (!viewerRef.current) return;
    setIsLoadingScene(true);
    setError("");
    try {
      await viewerRef.current.clearScenes?.();
      await viewerRef.current.addSplatScene(url, {
        showLoadingUI: true,
        ...(format ? { format } : {}),
      });
      setSceneName(url.split("/").pop() || "scene");

      // 업로드 직후 카메라 자동 맞춤
      fitCameraToScene(viewerRef.current, THREE);
      requestAnimationFrame(() => fitCameraToScene(viewerRef.current, THREE));

      // ↑ 기본 Y-up 가정 후, Z-up 추정되면 회전 적용
      setTimeout(() => {
        const b = getSceneBounds(viewerRef.current, THREE);
        if (b && b.diag > 0) {
          // Z축 길이가 Y축보다 훨씬 크면 Z-up으로 본다(휴리스틱)
          if (b.size.z > b.size.y * 1.5) {
            applyOrientation(viewerRef.current, THREE, "Z");
          } else {
            applyOrientation(viewerRef.current, THREE, "Y");
          }
        }
      }, 80);

      drawOverlay();
    } catch (e) {
      console.error(e);
      setError("씬 로드 실패: URL/CORS/포맷을 확인(.ksplat/.splat/.ply)");
    } finally {
      setIsLoadingScene(false);
    }
  }

  function onPickFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file); // blob: URL
    loadScene(url, guessFormat(file.name));
    setSceneName(file.name);
  }

  // --- 화면 클릭 → 핀 추가 ---
  function onHitClick(ev) {
    if (!pinMode) return;
    const rect = hitRef.current.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    setDraftPin({ x, y });
    setShowPinModal(true);
    setPinMode(false);
  }

  function addPin(data) {
    const id = Math.random().toString(36).slice(2);
    setPins((p) => [{ id, ...data, createdAt: new Date().toISOString() }, ...p]);
    setDraftPin(null);
    setShowPinModal(false);
  }

  function PinModal({ onClose }) {
    const [type, setType] = useState("침수 높이");
    const [message, setMessage] = useState("");
    const [height, setHeight] = useState("");
    return (
      <div className="modalBg">
        <div className="modal">
          <div className="modalHead">
            <strong>제보 추가</strong>
            <button className="btn" onClick={onClose}>닫기</button>
          </div>
          <div className="modalBody">
            <label className="lbl">유형
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option>침수 높이</option>
                <option>통행 곤란</option>
                <option>배수구 막힘</option>
              </select>
            </label>
            {type === "침수 높이" && (
              <label className="lbl">침수 높이(cm, 선택)
                <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="예: 12" />
              </label>
            )}
            <label className="lbl">설명(선택)
              <textarea rows="3" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="상황을 간단히 적어주세요" />
            </label>
          </div>
          <div className="modalFoot">
            <button className="btn" onClick={onClose}>취소</button>
            <button
              className="btn primary"
              onClick={() =>
                addPin({
                  x: draftPin.x,
                  y: draftPin.y,
                  type,
                  message: message || undefined,
                  heightCm: height ? Number(height) : undefined,
                })
              }
            >제출</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="brand">3DGS 홍수 데모</div>
        <div className="spacer" />
        <div className="gauge">
          <span className={gaugeClass}>{gaugeLevel}</span>
          <select value={gaugeLevel} onChange={(e) => setGaugeLevel(e.target.value)} className="select">
            <option>정상</option><option>주의</option><option>경계</option><option>심각</option>
          </select>
        </div>
      </header>

      {/* Main */}
      <main className="main">
        {/* Viewer */}
        <section className="panel viewer">
          <div className="viewerWrap">
            <div ref={containerRef} className="canvas3d" />
            <canvas ref={overlayRef} className="overlay" />
            <div
              ref={hitRef}
              className={`hitLayer ${pinMode ? "" : "disabled"}`}
              onClick={onHitClick}
            />

            <div className="sceneBadge">
              {isLoadingScene ? "씬 로딩중…" : sceneName}
            </div>
            {!!error && <div className="error">{error}</div>}

            <div className="floatBtns">
              <button className="btn" onClick={() => fitCameraToScene(viewerRef.current, THREE)}>뷰 리셋</button>
              <button className="btn" onClick={() => applyOrientation(viewerRef.current, THREE, "Y")}>Y-up</button>
              <button className="btn" onClick={() => applyOrientation(viewerRef.current, THREE, "Z")}>Z-up</button>
              <button className={`btn ${pinMode ? "primary" : ""}`} onClick={() => setPinMode(v => !v)}>
                {pinMode ? "화면 클릭으로 위치 선택중…" : "+ 제보"}
              </button>
            </div>

          </div>
        </section>

        {/* Controls */}
        <aside className="panel controls">
          {/* Scene loader */}
          <div className="card">
            <h3>씬 불러오기</h3>
            <div className="row">
              <label className="fileBtn">
                <input type="file" accept=".ksplat,.splat,.ply" onChange={onPickFile} />
                로컬 파일
              </label>
              <span className="hint">(.ksplat / .splat / .ply)</span>
            </div>
            <div className="row">
              <input className="input" placeholder="혹은 URL 붙여넣기" value={sceneUrl} onChange={(e) => setSceneUrl(e.target.value)} />
              <button className="btn primary" onClick={() => loadScene(sceneUrl, guessFormat(sceneUrl))}>로드</button>
            </div>
            <p className="tiny">URL은 CORS 허용이 필요합니다. 로컬 파일이 가장 간단합니다.</p>
          </div>

          {/* Hazard overlay */}
          <div className="card">
            <h3>위험 오버레이(데모)</h3>
            <div className="row between">
              <span>표시</span>
              <button className={`toggle ${showHazard ? "on" : ""}`} onClick={() => setShowHazard(v => !v)}>
                {showHazard ? "ON" : "OFF"}
              </button>
            </div>
            <div className="row">
              <button className={`chip ${hazardLevel === "low" ? "active" : ""}`} onClick={() => setHazardLevel("low")}>낮음</button>
              <button className={`chip ${hazardLevel === "mid" ? "active" : ""}`} onClick={() => setHazardLevel("mid")}>중간</button>
              <button className={`chip ${hazardLevel === "high" ? "active" : ""}`} onClick={() => setHazardLevel("high")}>높음</button>
            </div>
            <label className="sliderLabel">투명도: {Math.round(hazardOpacity * 100)}%</label>
            <input type="range" min="0" max="1" step="0.02" value={hazardOpacity} onChange={(e) => setHazardOpacity(Number(e.target.value))} />
          </div>

          {/* Recent pins */}
          <div className="card">
            <h3>최근 제보(로컬)</h3>
            {pins.length === 0 ? (
              <p className="tiny">아직 제보가 없습니다. 좌측 하단 ‘+ 제보’를 눌러 화면을 클릭해보세요.</p>
            ) : (
              <ul className="pinList">
                {pins.map(p => (
                  <li key={p.id}>
                    <div className="pinRow">
                      <span className="dot" data-type={p.type}></span>
                      <div className="pinCol">
                        <div className="pinTitle">
                          {p.type}{typeof p.heightCm === "number" ? ` · ${p.heightCm}cm` : ""}
                        </div>
                        {p.message && <div className="pinMsg">{p.message}</div>}
                        <div className="pinMeta">{new Date(p.createdAt).toLocaleString()}</div>
                      </div>
                      <button className="btn" onClick={() => setPins(arr => arr.filter(x => x.id !== p.id))}>삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Safety card */}
          <div className="card">
            <h3>안내</h3>
            <p className="desc">
              본 데모는 데이터 연결 전 단계의 UI 검증용입니다. 실제 위험 지도/수문 데이터는 배포 시 최신본으로 교체하고, 사진의 얼굴·차량번호는 블러 처리하세요.
            </p>
          </div>
        </aside>
      </main>

      {showPinModal && draftPin && (
        <PinModal onClose={() => { setShowPinModal(false); setDraftPin(null); }} />
      )}
    </div>
  );
}
