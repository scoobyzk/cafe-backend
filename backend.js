const express = require("express");
const cron = require("node-cron");

const app = express();

let dados = {
  arabica: [],
  robusta: [],
  atualizadoEm: null
};

let cache = {};
let browserGlobal = null;

const contratosRC = [
  { nome: "Julho", url: "https://www.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCN2026" },
  { nome: "Setembro", url: "https://br.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCU2026" },
  { nome: "Novembro", url: "https://br.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCX2026" }
];

const contratosKC = [
  { nome: "Julho", url: "https://www.tradingview.com/symbols/ICEUS-KC1!/?contract=KCN2026" },
  { nome: "Setembro", url: "https://www.tradingview.com/symbols/ICEUS-KC1!/?contract=KCU2026" },
  { nome: "Dezembro", url: "https://www.tradingview.com/symbols/ICEUS-KC1!/?contract=KCZ2026" }
];

const isProd = process.env.NODE_ENV === "production";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHorarioPermitido() {
  const now = new Date();
  const brasilTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const day = brasilTime.getDay();
  const hours = brasilTime.getHours();
  const minutes = brasilTime.getMinutes();

  if (day === 0 || day === 6) return false;

  const currentMinutes = hours * 60 + minutes;
  const startMinutes = 4 * 60 + 55;
  const endMinutes = 16 * 60 + 5;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

async function criarBrowser() {
  if (browserGlobal) return browserGlobal;

  if (!isProd) {
    const puppeteer = require("puppeteer");

    browserGlobal = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

  } else {
    const puppeteerCore = require("puppeteer-core");
    const chromium = require("@sparticuz/chromium");

    browserGlobal = await puppeteerCore.launch({
      args: [...chromium.args],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  return browserGlobal;
}

// ===================== SCRAPER =====================

async function pegarPreco(browser, url) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForSelector("body");
    await delay(3000);

    let result = await page.evaluate(() => {
      const get = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      const preco =
        get(".js-symbol-last") ||
        get("span[class*='last']");

      // 🔥 PEGA DIRETO OS PONTOS (SEM PROCESSAR)
      const pontos =
        get(".js-symbol-change") ||
        get("span[class*='change']");

      return {
        preco,
        pontos
      };
    });

    let { preco, pontos } = result;

    if (preco) {
      const num = parseFloat(preco.replace(',', '.'));
      preco = Number(num).toFixed(3);
    } else {
      preco = cache[url]?.preco || null;
    }

    // 🔥 mantém exatamente como vem (-81 ou +81)
    pontos = pontos ?? cache[url]?.pontos ?? null;

    cache[url] = { preco, pontos };

    console.log("Dados:", url, { preco, pontos });

    return { preco, pontos };

  } catch (err) {
    console.log("Erro:", err.message);

    return {
      preco: cache[url]?.preco || null,
      pontos: cache[url]?.pontos || null
    };
  } finally {
    try { await page.close(); } catch {}
  }
}

// ===================== LOOP =====================

let rodando = false;

async function atualizarDados() {
  if (rodando) return;
  rodando = true;

  try {
    const browser = await criarBrowser();

    const resultadosRC = [];
    const resultadosKC = [];

    for (const c of contratosRC) {
      const data = await pegarPreco(browser, c.url);
      resultadosRC.push({ nome: c.nome, ...data });
    }

    for (const c of contratosKC) {
      const data = await pegarPreco(browser, c.url);
      resultadosKC.push({ nome: c.nome, ...data });
    }

    dados = {
      arabica: resultadosKC,
      robusta: resultadosRC,
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    };

    console.log("Atualizado!");

  } catch (e) {
    console.log("Erro geral:", e.message);
  } finally {
    rodando = false;
  }
}

// ===================== ROTAS =====================

app.get("/", (req, res) => {
  res.send("API de Café rodando 🚀");
});

app.get("/precos", (req, res) => {
  res.json(dados);
});

// ===================== CRON =====================

cron.schedule("*/5 * * * *", () => {
  if (!isHorarioPermitido()) return;
  atualizarDados();
});

// ===================== START =====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Rodando na porta ${PORT}`);

  if (isHorarioPermitido()) {
    atualizarDados();
  }
});