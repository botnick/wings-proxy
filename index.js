const HyperExpress = require('hyper-express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
require('dotenv').config(); // โหลดค่าจากไฟล์ .env

// สร้างเซิร์ฟเวอร์ HyperExpress
const app = new HyperExpress.Server();

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
    ipAddress: req.ip,
    ipType: req.ip.includes(':') ? 'IPv6' : 'IPv4'
});

// เส้นทางหลัก '/'
app.get('/', (req, res) => {
    res.json(createResponse("success", req));
});

// Proxy สำหรับเส้นทาง /api
const proxyMiddleware = createProxyMiddleware({
    target: process.env.API_PROXY_URL,
    changeOrigin: true,
    proxyTimeout: 1000,
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        res.status(500).json({ error: 'Proxy Error' });
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying: ${req.method} ${req.url} to ${proxyReq.path}`);
    }
});

// ใช้ proxy สำหรับเส้นทาง /api
app.use('/api', proxyMiddleware);

// จัดการข้อผิดพลาด 404
app.use('*', (req, res) => {
    res.status(404).json(createResponse("error", req));
});

// SSL options จากไฟล์ .env
const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
};

// เริ่มต้นเซิร์ฟเวอร์บนพอร์ต 443 โดยใช้ SSL
app.listen(443, options)
    .then(() => console.log('Server started on port 443 with SSL'))
    .catch(console.error);

// จัดการข้อผิดพลาดที่ไม่ได้จัดการ
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
