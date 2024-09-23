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

// Create HTTP server
const server = http.createServer(app);

// Set up WebSocket proxy manually
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (ws, req) => {
    // Extract headers from the client request
    const clientHeaders = req.headers;

    // Create a WebSocket connection to the target server
    const targetWs = new WebSocket('ws://0.0.0.0:8080', {
        headers: clientHeaders  // Forward client headers to the target WebSocket server
    });

    // Wait until the target WebSocket is open before forwarding messages
    targetWs.on('open', () => {
        ws.on('message', (message) => {
            if (targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(message);  // Forward message from client to target server
            } else {
                console.error('Target WebSocket is not open');
            }
        });
    });

    targetWs.on('message', (message) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);  // Forward message from target server to client
        } else {
            console.error('Client WebSocket is not open');
        }
    });

    // Handle WebSocket closing
    ws.on('close', () => {
        targetWs.close();
    });

    targetWs.on('close', () => {
        ws.close();
    });
});

// Handle HTTP upgrade requests for WebSocket
server.on('upgrade', (request, socket, head) => {
    // Check if the request is for WebSocket
    if (request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Start HTTP server
server.listen(80, () => {
    console.log('Server started on port 80 (HTTP)');
});

// HTTPS setup if SSL certificates exist
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };
    const httpsServer = https.createServer(options, app);

    httpsServer.on('upgrade', (request, socket, head) => {
        if (request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
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

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);