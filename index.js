const express = require('express');
const proxy = require('express-http-proxy');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
require('dotenv').config(); // โหลดค่าจากไฟล์ .env

// สร้างเซิร์ฟเวอร์ Express
const app = express();

// ข้อมูลเซิร์ฟเวอร์
const serverInfo = {
    environment: process.env.APP_MODE || "unknown",
    service: process.env.APP_NAME || "unnamedService",
    version: process.env.APP_VERSION || "v1.0.0"
};

// สร้าง response
const createResponse = (status, req) => ({
    status,
    ...serverInfo,
    userAgent: req.headers['user-agent'] || 'unknown',
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
    ipType: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip).includes(':') ? 'IPv6' : 'IPv4'
});

// Log requests, including WebSocket detection
app.use((req, res, next) => {
    const isWebSocket = req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket';
    if (isWebSocket) {
        console.log(`Incoming WebSocket request: ${req.method} ${req.url}`);
    } else {
        console.log(`Incoming request: ${req.method} ${req.url}`);
    }
    next();
});

// HTTP Proxy for REST API
app.use('/api', proxy(process.env.API_PROXY_URL, {
    proxyReqPathResolver: (req) => {        
        return `${req.baseUrl}${req.url}`; // รวม '/api' เข้ากับ URL
    }
}));

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json(createResponse("error", req));
});

// สร้าง HTTP server
const server = http.createServer(app);

// สร้าง WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
    // สร้าง URL สำหรับเชื่อมต่อไปยังเซิร์ฟเวอร์ปลายทาง รวมพาธและ query parameters
    const backendUrl = `ws://0.0.0.0:8080${req.url}`;

    // สร้างการเชื่อมต่อไปยังเซิร์ฟเวอร์ปลายทาง โดยส่งต่อ headers ทั้งหมดจาก client
    const targetWs = new WebSocket(backendUrl, {
        headers: req.headers
    });

    // เมื่อการเชื่อมต่อกับเซิร์ฟเวอร์ปลายทางเปิดแล้ว
    targetWs.on('open', () => {
        // ส่งต่อข้อความจากลูกค้าไปยังเซิร์ฟเวอร์ปลายทาง
        ws.on('message', (message) => {
            targetWs.send(message);
        });

        // ส่งต่อข้อความจากเซิร์ฟเวอร์ปลายทางไปยังลูกค้า
        targetWs.on('message', (message) => {
            ws.send(message);
        });
    });

    // จัดการข้อผิดพลาด
    targetWs.on('error', (err) => {
        console.error('Error in target WebSocket connection:', err);
        ws.close();
    });

    ws.on('error', (err) => {
        console.error('Error in client WebSocket connection:', err);
        targetWs.close();
    });

    // จัดการการปิดการเชื่อมต่อ
    ws.on('close', () => {
        targetWs.close();
    });

    targetWs.on('close', () => {
        ws.close();
    });
});

// จัดการคำขอ HTTP upgrade สำหรับ WebSocket
server.on('upgrade', (request, socket, head) => {
    // ตรวจสอบว่าคำขอเป็น WebSocket หรือไม่
    if (request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// เริ่มต้น HTTP server
server.listen(80, () => {
    console.log('Server started on port 80 (HTTP)');
});

// ตั้งค่า HTTPS ถ้ามี SSL certificates
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };
    const httpsServer = https.createServer(options, app);

    // สร้าง WebSocket server สำหรับ HTTPS
    const wssHttps = new WebSocket.Server({ noServer: true });

    wssHttps.on('connection', (ws, req) => {
        const backendUrl = `ws://0.0.0.0:8080${req.url}`;

        const targetWs = new WebSocket(backendUrl, {
            headers: req.headers
        });

        targetWs.on('open', () => {
            ws.on('message', (message) => {
                targetWs.send(message);
            });

            targetWs.on('message', (message) => {
                ws.send(message);
            });
        });

        // จัดการข้อผิดพลาด
        targetWs.on('error', (err) => {
            console.error('Error in target WebSocket connection:', err);
            ws.close();
        });

        ws.on('error', (err) => {
            console.error('Error in client WebSocket connection:', err);
            targetWs.close();
        });

        ws.on('close', () => {
            targetWs.close();
        });

        targetWs.on('close', () => {
            ws.close();
        });
    });

    httpsServer.on('upgrade', (request, socket, head) => {
        if (request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket') {
            wssHttps.handleUpgrade(request, socket, head, (ws) => {
                wssHttps.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });

    httpsServer.listen(443, () => {
        console.log('Server started on port 443 with SSL (HTTPS)');
    });
} else {
    console.error('SSL key or certificate not found. HTTPS server not started.');
}

// จัดการ uncaught exceptions และ unhandled rejections
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
