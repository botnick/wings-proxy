const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const https = require('https');
const fs = require('fs');
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

// เส้นทางหลัก '/'
app.get('/', (req, res) => {
    res.json(createResponse("success", req));
});

// CORS Middleware เพื่อจัดการ headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // แก้ตรงนี้
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Authorization, Accept, Origin, DNT, X-CustomHeader, Keep-Alive, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Content-Range, Range');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');

    // หากเป็นการ request แบบ OPTIONS ให้ตอบกลับ status 204 โดยไม่ต้องส่งต่อไปยัง backend
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Max-Age', '1728000');
        res.header('Content-Type', 'text/plain charset=UTF-8');
        res.header('Content-Length', '0');
        return res.sendStatus(204);
    }
    
    next();
});

// Proxy สำหรับเส้นทาง /api
const proxyMiddleware = createProxyMiddleware({
    target: process.env.API_PROXY_URL, // แก้ตรงนี้
    changeOrigin: true,
    proxyTimeout: 5000, // เพิ่ม timeout เป็น 5 วินาที
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        
        if (res.headersSent) {
            return req.socket.destroy();
        }

        res.status(500).json({
            error: 'Proxy Error',
            message: err.message,
            code: err.code || 'unknown'
        });
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying: ${req.method} ${req.url} to ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {       
        proxyRes.headers['Access-Control-Allow-Origin'] = '*'; // แก้ตรงนี้
    }
});

// ใช้ proxy สำหรับเส้นทาง /api
app.use('/api', proxyMiddleware);

// จัดการข้อผิดพลาด 404
app.use('*', (req, res) => {
    res.status(404).json(createResponse("error", req));
});

// สร้างเซิร์ฟเวอร์ HTTP 
http.createServer(app).listen(80, () => {
    console.log('Server started on port 80 (HTTP)');
});

// ตรวจสอบว่าไฟล์ SSL key และ cert มีอยู่จริงก่อนสร้าง HTTPS server
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };

    https.createServer(options, app).listen(443, () => {
        console.log('Server started on port 443 with SSL (HTTPS)');
    });
} else {
    console.error('SSL key or certificate not found. HTTPS server not started.');
}

// จัดการข้อผิดพลาดที่ไม่ได้จัดการ
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
