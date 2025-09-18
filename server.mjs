// server.mjs
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// COOP/COEP 헤더: crossOriginIsolated = true
app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    // 선택: 외부 리소스 허용 범위
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
});

// 정적 파일 서빙 (CRA build)
app.use(
    express.static(path.join(__dirname, "build"), {
        setHeaders(res, filePath) {
            if (filePath.endsWith(".wasm")) {
                res.setHeader("Content-Type", "application/wasm");
            }
        },
    })
);

// SPA 라우팅
app.get(/.*/, (_, res) => {
    res.sendFile(path.join(__dirname, "build", "index.html"));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`✅ Server up: http://localhost:${PORT}`);
    console.log(`   COOP/COEP headers enabled (crossOriginIsolated expected = true)`);
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is in use. Change the port or stop the other process.`);
    } else {
        console.error("❌ Server error:", err);
    }
});
