const express = require("express");
const cron = require("node-cron");

const app = express();

let dados = {
  arabica: [],
  robusta: [],
  atualizadoEm: null
};

// 🔥 CACHE PRA NUNCA MAIS VOLTAR NULL
let cache = {};

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

// ---------------- BROWSER ----------------
async function criarBrowser() {
  if (!isProd) {
    const puppeteer = require("puppeteer");

    return await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }

  const puppeteerCore = require("puppeteer-core");
  const chromium = require("@sparticuz/chromium");

  return await puppeteerCore.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

// ---------------- FORMATAR PREÇO ----------------
function formatarPreco(valor) {
  if (valor < 10) {
    return Number(valor.toFixed(3));
  } else {
    return Number(valor.toFixed(2));
  }
}

// ---------------- PEGAR PREÇO (MODO BRUTO) ----------------
async function pegarPreco(browser, url) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    // 🔥 BLOQUEIA LIXO PESADO
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

    // 🔥 ESPERA BRUTA
    await new Promise(r => setTimeout(r, 5000));

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

    // 🔥 RETRY
    if (preco === null) {
      await new Promise(r => setTimeout(r, 3000));

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

    // 🔥 CACHE + FORMATAÇÃO
    if (preco !== null) {
      preco = formatarPreco(preco);
      cache[url] = preco;
    } else if (cache[url]) {
      preco = cache[url];
    }

    console.log("Preço:", url, preco);

    return preco;

  } catch (err) {
    console.log("Erro preço:", err.message);
    return cache[url] || null;

  } finally {
    await page.close();
  }
}

// ---------------- LOCK ----------------
let rodando = false;

// ---------------- ATUALIZAR ----------------
async function atualizarDados() {
  if (rodando) {
    console.log("Já está rodando, ignorando...");
    return;
  }

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