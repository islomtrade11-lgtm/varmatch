const express = require('express');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const Fuse = require('fuse.js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './streams_db.json';

// Создаем пустую базу, если её нет
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

app.use(express.static('public'));

// --- ЛОГИКА ВОРКЕРА (ПАРСИНГ) ---
async function scrapeStreams() {
    console.log('🚀 Воркер запущен: поиск трансляций...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        // ЗАМЕНИ НА РЕАЛЬНЫЙ САЙТ-ДОНОР (например, какой-нибудь livesport)
        const donorUrl = 'https://example-sports-site.com'; 
        await page.goto(donorUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Собираем ссылки на матчи (селекторы нужно подправить под конкретный сайт)
        const matches = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.match-item')); // Класс ссылки
            return items.map(el => ({
                title: el.innerText.toLowerCase(),
                url: el.href
            }));
        });

        let results = [];
        for (let match of matches.slice(0, 5)) { // Парсим первые 5 для теста
            const matchPage = await browser.newPage();
            await matchPage.goto(match.url);
            
            // Логика поиска m3u8 в сетевых запросах
            let m3u8 = null;
            matchPage.on('request', r => {
                if (r.url().includes('.m3u8')) m3u8 = r.url();
            });
            
            await new Promise(r => setTimeout(r, 5000)); // Ждем загрузки плеера
            if (m3u8) results.push({ title: match.title, stream: m3u8 });
            await matchPage.close();
        }

        fs.writeFileSync(DB_FILE, JSON.stringify(results));
        console.log(`✅ Найдено стримов: ${results.length}`);
    } catch (e) {
        console.error('❌ Ошибка воркера:', e.message);
    } finally {
        await browser.close();
    }
}

// Запуск парсинга каждые 30 минут
cron.schedule('*/30 * * * *', scrapeStreams);
scrapeStreams(); // Первый запуск при старте

// --- API ДЛЯ САЙТА ---
app.get('/api/matches', (req, res) => {
    const db = JSON.parse(fs.readFileSync(DB_FILE));
    res.json(db);
});

app.get('/api/search', (req, res) => {
    const query = req.query.q;
    const db = JSON.parse(fs.readFileSync(DB_FILE));
    const fuse = new Fuse(db, { keys: ['title'], threshold: 0.4 });
    res.json(fuse.search(query));
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
