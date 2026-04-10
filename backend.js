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
  { nome: "Atual", url: "https://www.investing.com/commodities/london-coffee?cid=1185510" },
  { nome: "Proximo", url: "https://www.investing.com/commodities/london-coffee?cid=1185511" },
  { nome: "Futuro", url: "https://www.investing.com/commodities/london-coffee?cid=1185512" }
];

const contratosKC = [
  { nome: "Atual", url: "https://www.investing.com/commodities/us-coffee-c" },
  { nome: "Proximo", url: "https://www.investing.com/commodities/us-coffee-c?cid=1186961" },
  { nome: "Futuro", url: "https://www.investing.com/commodities/us-coffee-c?cid=1186962" }
];

const isProd = process.env.NODE_ENV === "production";

// ---------------- DELAY COMPATÍVEL (SUBSTITUI waitForTimeout) ----------------
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------- BROWSER ----------------
async function criarBrowser() {
  if (browserGlobal) return browserGlobal;

  if (!isProd) {
    const puppeteer = require("puppeteer");

    browserGlobal = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

  } else {
    const puppeteerCore = require("puppeteer-core");
    const chromium = require("@sparticuz/chromium");

    browserGlobal = await puppeteerCore.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  return browserGlobal;
}

// ---------------- FORMATAR ----------------
function formatarPreco(valor) {
  if (valor < 10) return valor.toFixed(3);
  return valor.toFixed(2);
}

// ---------------- PEGAR PREÇO (ROBUSTO FINAL) ----------------
async function pegarPreco(browser, url) {
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

    // 🔥 delay seguro (substitui waitForTimeout)
    await delay(4000);

    let preco = await page.evaluate(() => {
      const el =
        document.querySelector('[data-test="instrument-price-last"]') ||
        document.querySelector('span[data-test="instrument-price-last"]') ||
        document.querySelector('.text-2xl') ||
        document.querySelector('.last-price-value');

      if (!el) return null;

      const texto = el.innerText.replace(/[^\d.,]/g, '').replace(',', '.');
      const valor = parseFloat(texto);

      return isNaN(valor) ? null : valor;
    });

    // 🔥 retry leve
    if (preco === null) {
      await delay(2500);

      preco = await page.evaluate(() => {
        const el =
          document.querySelector('[data-test="instrument-price-last"]') ||
          document.querySelector('.text-2xl') ||
          document.querySelector('.last-price-value');

        if (!el) return null;

        const texto = el.innerText.replace(/[^\d.,]/g, '').replace(',', '.');
        const valor = parseFloat(texto);

        return isNaN(valor) ? null : valor;
      });
    }

    if (preco !== null) {
      const formatado = formatarPreco(preco);
      cache[url] = formatado;
      console.log("Preço:", url, formatado);
      return formatado;
    }

    if (cache[url]) {
      console.log("Cache usado:", url, cache[url]);
      return cache[url];
    }

    return null;

  } catch (err) {
    console.log("Erro preço:", err.message);
    return cache[url] || null;

  } finally {
    try {
      if (!page.isClosed()) await page.close();
    } catch {}
  }
}

// ---------------- LOCK ----------------
let rodando = false;

// ---------------- ATUALIZAR ----------------
async function atualizarDados() {
  if (rodando) return;

  rodando = true;

  try {
    console.log("Atualizando dados...");

    const browser = await criarBrowser();

    const resultadosRC = [];
    const resultadosKC = [];

    for (const c of contratosRC) {
      const preco = await pegarPreco(browser, c.url);
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

// ---------------- ROTAS ----------------
app.get("/", (req, res) => {
  res.send("API de Café rodando 🚀");
});

app.get("/precos", (req, res) => {
  res.json(dados);
});

// ---------------- CRON ----------------
cron.schedule("*/5 * * * *", () => {
  atualizarDados();
});

// ---------------- START ----------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  atualizarDados();
});