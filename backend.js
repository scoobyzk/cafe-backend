const express = require("express");
const puppeteer = require("puppeteer");
const cron = require("node-cron");

const app = express();

let dados = {
  arabica: [],
  robusta: [],
  atualizadoEm: null
};

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

// ---------------- BROWSER ----------------
async function criarBrowser() {
  return await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

// ---------------- PEGAR PREÇO ----------------
async function pegarPreco(browser, url) {
  const page = await browser.newPage();

  try {
    console.log("Abrindo:", url);

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    // 🔥 CORREÇÃO AQUI (sem waitForTimeout)
    await new Promise(r => setTimeout(r, 3000));

    const preco = await page.evaluate(() => {
      const seletores = [
        '[data-test="instrument-price-last"]',
        'span[data-test="instrument-price-last"]',
        '.text-2xl',
        '.instrument-price_last__KQzyA',
        '.last-price-value'
      ];

      for (let s of seletores) {
        const el = document.querySelector(s);
        if (el && el.innerText) {
          const valor = parseFloat(el.innerText.replace(",", ""));
          if (!isNaN(valor)) return valor;
        }
      }

      return null;
    });

    console.log("Preço:", preco);
    return preco;

  } catch (err) {
    console.log("Erro preço:", err.message);
    return null;

  } finally {
    await page.close();
  }
}

// ---------------- ATUALIZAR ----------------
async function atualizarDados() {
  try {
    console.log("Atualizando dados...");

    const browser = await criarBrowser();

    const resultadosRC = [];
    const resultadosKC = [];

    for (let c of contratosRC) {
      const preco = await pegarPreco(browser, c.url);
      resultadosRC.push({ nome: c.nome, preco });
    }

    for (let c of contratosKC) {
      const preco = await pegarPreco(browser, c.url);
      resultadosKC.push({ nome: c.nome, preco });
    }

    await browser.close();

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
  }
}

// ---------------- ROTAS ----------------
app.get("/", (req, res) => {
  res.send("API de Café rodando 🚀");
});

app.get("/precos", (req, res) => {
  res.json(dados);
});

// ---------------- CRON 5 MIN ----------------
cron.schedule("*/5 * * * *", atualizarDados);

// ---------------- START ----------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  atualizarDados();
});