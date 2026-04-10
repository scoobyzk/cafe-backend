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

// ===================== CONTRATOS =====================

const contratosRC = [
  { nome: "Maio", url: "https://www.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCK2026", simbolo: "RCK2026" },
  { nome: "Julho", url: "https://www.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCN2026", simbolo: "RCN2026" },
  { nome: "Setembro", url: "https://www.tradingview.com/symbols/ICEEUR-RC1!/?contract=RCU2026", simbolo: "RCU2026" }
];

const contratosKC = [
  { nome: "Atual", url: "https://www.investing.com/commodities/us-coffee-c" },
  { nome: "Proximo", url: "https://www.investing.com/commodities/us-coffee-c?cid=1186961" },
  { nome: "Futuro", url: "https://www.investing.com/commodities/us-coffee-c?cid=1186962" }
];

// ===================== UTIL =====================

const isProd = process.env.NODE_ENV === "production";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===================== BROWSER =====================

async function criarBrowser() {
  if (browserGlobal) return browserGlobal;

  if (!isProd) {
    const puppeteer = require("puppeteer");

    browserGlobal = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

  } else {
    const puppeteerCore = require("puppeteer-core");
    const chromium = require("@sparticuz/chromium");

    browserGlobal = await puppeteerCore.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  return browserGlobal;
}

// ===================== FORMATAR =====================

function formatarPreco(valor) {
  if (valor < 10) return valor.toFixed(3);
  return valor.toFixed(2);
}

// ===================== SCRAPER =====================

async function pegarPreco(browser, url, simbolo = null) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const tipo = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(tipo)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // ===================== TRADINGVIEW (FIX REAL) =====================
    if (url.includes("tradingview.com")) {

      await page.waitForSelector("body");

      await page.waitForFunction((simbolo) => {
        const el = document.querySelector(".js-symbol-last, span[class*='last']");
        return el && el.innerText && el.innerText.length > 0;
      }, { timeout: 20000 }, simbolo);

      await delay(3000);

      let preco = await page.evaluate(() => {
        const el =
          document.querySelector(".js-symbol-last") ||
          document.querySelector("span[class*='last']");

        if (!el) return null;

        const texto = el.innerText.replace(/[^\d.,]/g, '').replace(',', '.');
        const valor = parseFloat(texto);

        return isNaN(valor) ? null : valor;
      });

      if (preco !== null) {
        const formatado = Number(preco).toFixed(3);
        cache[url] = formatado;
        console.log("Preço:", url, formatado);
        return formatado;
      }

      return cache[url] || null;
    }

    // ===================== INVESTING (SEU ORIGINAL FUNCIONANDO) =====================

    await delay(4000);

    let preco = await page.evaluate(() => {
      const el =
        document.querySelector('[data-test="instrument-price-last"]') ||
        document.querySelector('.text-2xl') ||
        document.querySelector('.last-price-value');

      if (!el) return null;

      const texto = el.innerText.replace(/[^\d.,]/g, '').replace(',', '.');
      const valor = parseFloat(texto);

      return isNaN(valor) ? null : valor;
    });

    if (preco !== null) {
      const formatado = formatarPreco(preco);
      cache[url] = formatado;
      console.log("Preço:", url, formatado);
      return formatado;
    }

    return cache[url] || null;

  } catch (err) {
    console.log("Erro preço:", err.message);
    return cache[url] || null;

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
    console.log("Atualizando dados...");

    const browser = await criarBrowser();

    const resultadosRC = [];
    const resultadosKC = [];

    for (const c of contratosRC) {
      const preco = await pegarPreco(browser, c.url, c.simbolo);
      resultadosRC.push({ nome: c.nome, preco });
    }

    for (const c of contratosKC) {
      const preco = await pegarPreco(browser, c.url);
      resultadosKC.push({ nome: c.nome, preco });
    }

    dados = {
      arabica: resultadosKC,
      robusta: resultadosRC,
      atualizadoEm: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    };

    console.log("Atualizado com sucesso!");

  } catch (e) {
    console.log("Erro geral:", e.message);

    if (browserGlobal) {
      try { await browserGlobal.close(); } catch {}
      browserGlobal = null;
    }

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
  atualizarDados();
});

// ===================== START =====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  atualizarDados();
});