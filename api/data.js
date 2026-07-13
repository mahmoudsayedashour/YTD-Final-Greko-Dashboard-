'use strict';
// ═══════════════════════════════════════════════════════════════════
//  GREKO EGYPT  –  api/data.js  (Vercel Serverless)
//  Single calculation engine. All pages use this endpoint.
// ═══════════════════════════════════════════════════════════════════

const XLSX = require('xlsx');

const WORKBOOK_URL =
  'https://kpvezuvifxoatyen.public.blob.vercel-storage.com/New%20Microsoft%20Excel%20Worksheet.xlsx';

const MONTHS_FULL  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];

// ─────────────────────────────────────────────────────────────────
// Module-level cache (survives warm Vercel invocations)
// ─────────────────────────────────────────────────────────────────
let _parsed    = null;
let _cacheTime = 0;
const CACHE_TTL = 3_600_000; // 1 hour

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const sf = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const ss = v => (v == null ? '' : String(v).trim());

function excelDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86_400_000));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
function rowMonth(v) { const d = excelDate(v); return d ? d.getMonth() + 1 : 0; }
function rowYear(v)  { const d = excelDate(v); return d ? d.getFullYear()   : 0; }

// ─────────────────────────────────────────────────────────────────
// DAX Accumulator  (THE single calculation engine)
// Every aggregation everywhere uses these three functions.
// ─────────────────────────────────────────────────────────────────
const newAcc = () => ({
  t_sum: 0, t_partial: 0, t_rinv: 0,
  c_sum: 0, c_partial: 0, c_rinv: 0,
  q_sum: 0, q_partial: 0, q_rinv: 0,
});

/**
 * Feed one raw row into an accumulator.
 * type   = Invoice lines/Number Type
 * ref    = Invoice lines/Reference
 * ton    = Num Ton
 * carton = Num Carton
 * cups   = Invoice lines/Quantity
 */
function feed(acc, type, ref, ton, carton, cups) {
  const partial = ref.length > 0 && ref[0].toUpperCase() === 'R';
  const isRINV  = type === 'RINV';

  acc.t_sum += ton;    acc.c_sum += carton;    acc.q_sum += cups;

  if (partial) {
    acc.t_partial += Math.abs(ton);
    acc.c_partial += Math.abs(carton);
    acc.q_partial += Math.abs(cups);
  }
  if (isRINV) {
    acc.t_rinv += ton;
    acc.c_rinv += carton;
    acc.q_rinv += cups;
  }
}

/**
 * Resolve an accumulator into final Sales / Returns values.
 * Step 1: Partial Returns = SUM(ABS(Ton)) where Ref starts with 'R'
 * Step 2: Return = ABS(RINV_sum - Partial)
 * Step 3: Sales  = SUM(Ton) - Partial - Return
 */
function resolve(acc) {
  const t_ret  = Math.abs(acc.t_rinv - acc.t_partial);
  const c_ret  = Math.abs(acc.c_rinv - acc.c_partial);
  const q_ret  = Math.abs(acc.q_rinv - acc.q_partial);
  return {
    ton:    { s: acc.t_sum - acc.t_partial - t_ret, r: t_ret, partial: acc.t_partial },
    carton: { s: acc.c_sum - acc.c_partial - c_ret, r: c_ret, partial: acc.c_partial },
    cups:   { s: acc.q_sum - acc.q_partial - q_ret, r: q_ret, partial: acc.q_partial },
  };
}

/** Add source accumulator into destination */
function addAcc(dst, src) {
  dst.t_sum += src.t_sum; dst.t_partial += src.t_partial; dst.t_rinv += src.t_rinv;
  dst.c_sum += src.c_sum; dst.c_partial += src.c_partial; dst.c_rinv += src.c_rinv;
  dst.q_sum += src.q_sum; dst.q_partial += src.q_partial; dst.q_rinv += src.q_rinv;
}

// ─────────────────────────────────────────────────────────────────
// Workbook Parsing (runs once, cached)
// ─────────────────────────────────────────────────────────────────
let currentStep = 'Idle';

async function buildParsed() {
  currentStep = 'Fetching workbook';
  console.log(`[api/data] ${currentStep} …`);
  let res;
  try {
    res = await fetch(WORKBOOK_URL);
  } catch (e) {
    throw new Error(`Failed to fetch WORKBOOK_URL: ${e.message}`);
  }
  if (!res.ok) throw new Error(`Workbook fetch failed: HTTP ${res.status} ${res.statusText}`);
  
  currentStep = 'Reading arrayBuffer';
  console.log(`[api/data] ${currentStep} …`);
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch(e) {
    throw new Error(`Failed to read arrayBuffer: ${e.message}`);
  }
  
  currentStep = 'XLSX.read()';
  const mem1 = process.memoryUsage();
  console.log(`[api/data] ${currentStep} … (Buffer size: ${(buf.length/1024/1024).toFixed(2)} MB, Heap used: ${(mem1.heapUsed/1024/1024).toFixed(2)} MB)`);
  let wb;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  } catch(e) {
    throw new Error(`XLSX.read failed: ${e.message}`);
  }
  const mem2 = process.memoryUsage();
  console.log(`[api/data] Finished XLSX.read (Heap used: ${(mem2.heapUsed/1024/1024).toFixed(2)} MB)`);

  currentStep = 'Reading sheet names';
  const sheetNames = wb.SheetNames;
  console.log(`[api/data] Sheets found: ${sheetNames.join(', ')}`);

  // ── 1. Lookup maps (built once) ────────────────────────────────
  const productMap  = {};
  const categoryMap = {};
  const channelMap  = {};

  currentStep = 'Parsing Main Data';
  try {
    const mainRows = XLSX.utils.sheet_to_json(wb.Sheets['Main Data'] || {}, { defval: '' });
    for (const r of mainRows) {
      const code = ss(r['Code'] || r['code'] || r['Product Code']);
      if (!code) continue;
      productMap[code]  = ss(r['Product']  || r['product']  || r['Product Name']);
      categoryMap[code] = ss(r['Category'] || r['category'] || r['Categories'] || r['Cat']);
    }
  } catch(e) { throw new Error(`Error mapping 'Main Data': ${e.message}`); }

  currentStep = 'Parsing Customers';
  try {
    const custRows = XLSX.utils.sheet_to_json(wb.Sheets['Customers'] || {}, { defval: '' });
    for (const r of custRows) {
      const name = ss(r['Name'] || r['Partner'] || r['Customer'] || r['Display Name']);
      const ch   = ss(r['Channel'] || r['channel'] || r['Trade Channel']);
      if (name) channelMap[name] = ch || 'Other';
    }
  } catch(e) { throw new Error(`Error mapping 'Customers': ${e.message}`); }

  // ── 2. Parse Forecast sheets ───────────────────────────────────
  function parseForecast(sheetName) {
    currentStep = `Parsing ${sheetName}`;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) { console.warn(`[api/data] Forecast sheet missing: ${sheetName}`); return {}; }
    try {
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval: 0 });
      const map   = {};
      for (const r of rows) {
        const code = ss(r['Code'] || r['code']);
        if (!code) continue;
        map[code] = {};
        for (let m = 1; m <= 12; m++) {
          const mn = MONTHS_FULL[m - 1];
          map[code][m] = {
            ton:    sf(r[`${mn} Ton`]     ?? r[`${mn}Ton`]     ?? r[`${mn} ton`]),
            carton: sf(r[`${mn} Cartons`] ?? r[`${mn}Cartons`] ?? r[`${mn} carton`] ?? r[`${mn} Carton`]),
            cups:   sf(r[`${mn} Cups`]    ?? r[`${mn}Cups`]    ?? r[`${mn} cups`])  || 0,
          };
        }
      }
      return map;
    } catch(e) {
      throw new Error(`Error parsing forecast sheet '${sheetName}': ${e.message}`);
    }
  }

  const fc25 = parseForecast('Forecast 25');
  const fc26 = parseForecast('Forecast 26');

  // ── 3. Parse Actual sheets ─────────────────────────────────────
  function parseActual(sheetName) {
    currentStep = `Parsing ${sheetName}`;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) { console.warn(`[api/data] Sheet missing: ${sheetName}`); return []; }
    try {
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval: null });
      const out   = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const delivDate = r['Delivery Date'];
          const month = rowMonth(delivDate);
          const year  = rowYear(delivDate);
          if (!month || !year) continue;

          const code    = ss(r['Code']);
          const partner = ss(r['Invoice lines/Partner']
                          ?? r['Invoice Partner Display Name']
                          ?? r['Invoice Partner Display Name.1']
                          ?? r['Partner']);
          const channel = ss(r['Channel']) || channelMap[partner] || 'Other';

          out.push({
            year, month, code, customer: partner, channel,
            product:  productMap[code]  || ss(r['Invoice lines/Product'] || code),
            category: categoryMap[code] || 'Unknown',
            type:     ss(r['Invoice lines/Number Type']),
            ref:      ss(r['Invoice lines/Reference']),
            ton:      sf(r['Num Ton']),
            carton:   sf(r['Num Carton']),
            cups:     sf(r['Invoice lines/Quantity']),
          });
        } catch(err) {
          const eObj = new Error(err.message);
          eObj.row = i + 1;
          eObj.rowData = JSON.stringify(r).substring(0,100);
          throw eObj;
        }
      }
      return out;
    } catch(e) {
      if (e.row) throw e; // bubble up precise row error
      throw new Error(`Error parsing actual sheet '${sheetName}': ${e.message}`);
    }
  }

  const rows25 = parseActual('Actual 25');
  const rows26 = parseActual('Actual 2026');

  currentStep = 'Building aggregates completed';
  console.log(`[api/data] Done. Rows: ${rows25.length} (2025) + ${rows26.length} (2026)`);

  return { rows25, rows26, fc25, fc26, productMap, categoryMap, channelMap };
}

async function getParsed() {
  if (!_parsed || (Date.now() - _cacheTime > CACHE_TTL)) {
    _parsed    = await buildParsed();
    _cacheTime = Date.now();
  }
  return _parsed;
}

// ─────────────────────────────────────────────────────────────────
// Aggregation Engine
// ─────────────────────────────────────────────────────────────────
function aggregateRows(rows, months, filters = {}) {
  const { channel, category, customer } = filters;
  const monthSet = new Set(months);

  const total      = newAcc();
  const byMonth    = {};
  const byCategory = {};
  const byProduct  = {};
  const byCustomer = {};
  const byChannel  = {};
  const custSet    = new Set(); // unique active customers

  for (const r of rows) {
    if (!monthSet.has(r.month))                    continue;
    if (channel  && r.channel  !== channel)        continue;
    if (category && r.category !== category)       continue;
    if (customer && r.customer !== customer)       continue;

    const { type, ref, ton, carton, cups } = r;

    // Ensure group accumulators exist
    if (!byMonth[r.month])          byMonth[r.month]          = newAcc();
    if (!byCategory[r.category])    byCategory[r.category]    = newAcc();
    if (!byProduct[r.code])         byProduct[r.code]         = newAcc();
    if (!byCustomer[r.customer])    byCustomer[r.customer]    = newAcc();
    if (!byChannel[r.channel])      byChannel[r.channel]      = newAcc();

    // Feed same row into every relevant accumulator (single engine call)
    for (const acc of [total, byMonth[r.month], byCategory[r.category],
                       byProduct[r.code], byCustomer[r.customer], byChannel[r.channel]]) {
      feed(acc, type, ref, ton, carton, cups);
    }

    if (ton !== 0 || carton !== 0 || cups !== 0) custSet.add(r.customer);
  }

  return { total, byMonth, byCategory, byProduct, byCustomer, byChannel, custSet };
}

// ─────────────────────────────────────────────────────────────────
// Forecast helpers
// ─────────────────────────────────────────────────────────────────
function fcSum(fc, months, measure) {
  let t = 0;
  for (const code of Object.keys(fc))
    for (const m of months)
      t += fc[code]?.[m]?.[measure] ?? 0;
  return t;
}

function fcSumCode(fc, code, months, measure) {
  if (!fc[code]) return 0;
  return months.reduce((s, m) => s + (fc[code][m]?.[measure] ?? 0), 0);
}

function fcSumCat(fc, cat, months, measure, categoryMap) {
  let t = 0;
  for (const code of Object.keys(categoryMap))
    if (categoryMap[code] === cat && fc[code])
      for (const m of months)
        t += fc[code][m]?.[measure] ?? 0;
  return t;
}

function fcMonth(fc, month, measure) {
  return Object.values(fc).reduce((s, v) => s + (v[month]?.[measure] ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────
// Build full API response
// ─────────────────────────────────────────────────────────────────
function buildResponse(parsed, months, filters) {
  const { rows25, rows26, fc25, fc26, productMap, categoryMap, channelMap } = parsed;

  const agg25 = aggregateRows(rows25, months, filters);
  const agg26 = aggregateRows(rows26, months, filters);

  const res25 = resolve(agg25.total);
  const res26 = resolve(agg26.total);

  const hasCupsFc = months.some(m => Object.values(fc26).some(v => (v[m]?.cups ?? 0) > 0));

  // ── meta ──────────────────────────────────────────────────────
  const meta = {
    period:        MONTHS_SHORT[months[0]-1] + (months.length > 1 ? '–' + MONTHS_SHORT[months[months.length-1]-1] : ''),
    months,
    customers_25:  agg25.custSet.size,
    customers_26:  agg26.custSet.size,
    ton: {
      s25:   res25.ton.s,    r25: res25.ton.r,    partial25: res25.ton.partial,
      s26:   res26.ton.s,    r26: res26.ton.r,    partial26: res26.ton.partial,
      tgt25: fcSum(fc25, months, 'ton'),
      tgt26: fcSum(fc26, months, 'ton'),
    },
    carton: {
      s25:   res25.carton.s, r25: res25.carton.r, partial25: res25.carton.partial,
      s26:   res26.carton.s, r26: res26.carton.r, partial26: res26.carton.partial,
      tgt25: fcSum(fc25, months, 'carton'),
      tgt26: fcSum(fc26, months, 'carton'),
    },
    cups: {
      s25:   res25.cups.s,   r25: res25.cups.r,   partial25: res25.cups.partial,
      s26:   res26.cups.s,   r26: res26.cups.r,   partial26: res26.cups.partial,
      tgt25: hasCupsFc ? fcSum(fc25, months, 'cups') : null,
      tgt26: hasCupsFc ? fcSum(fc26, months, 'cups') : null,
    },
  };

  // ── monthly_data ──────────────────────────────────────────────
  const monthly_data = MONTHS_FULL.map((name, idx) => {
    const m   = idx + 1;
    const r25 = resolve(agg25.byMonth[m] || newAcc());
    const r26 = resolve(agg26.byMonth[m] || newAcc());
    return {
      month_id: m, month_short: MONTHS_SHORT[idx], month_name: name, in_ytd: months.includes(m),
      ton:    { s25: r25.ton.s,    r25: r25.ton.r,    s26: r26.ton.s,    r26: r26.ton.r,    tgt25: fcMonth(fc25,m,'ton'),    tgt26: fcMonth(fc26,m,'ton')    },
      carton: { s25: r25.carton.s, r25: r25.carton.r, s26: r26.carton.s, r26: r26.carton.r, tgt25: fcMonth(fc25,m,'carton'), tgt26: fcMonth(fc26,m,'carton') },
      cups:   { s25: r25.cups.s,   r25: r25.cups.r,   s26: r26.cups.s,   r26: r26.cups.r,   tgt25: hasCupsFc ? fcMonth(fc25,m,'cups') : null, tgt26: hasCupsFc ? fcMonth(fc26,m,'cups') : null },
    };
  });

  // ── category_data ─────────────────────────────────────────────
  const allCats = new Set([...Object.keys(agg25.byCategory), ...Object.keys(agg26.byCategory)]);
  const category_data = [];
  for (const cat of allCats) {
    if (!cat || cat === '' || cat === 'Unknown') continue;
    const r25 = resolve(agg25.byCategory[cat] || newAcc());
    const r26 = resolve(agg26.byCategory[cat] || newAcc());
    category_data.push({
      category: cat,
      ton:    { s25: r25.ton.s,    r25: r25.ton.r,    s26: r26.ton.s,    r26: r26.ton.r,    tgt25: fcSumCat(fc25,cat,months,'ton',categoryMap),    tgt26: fcSumCat(fc26,cat,months,'ton',categoryMap)    },
      carton: { s25: r25.carton.s, r25: r25.carton.r, s26: r26.carton.s, r26: r26.carton.r, tgt25: fcSumCat(fc25,cat,months,'carton',categoryMap), tgt26: fcSumCat(fc26,cat,months,'carton',categoryMap) },
      cups:   { s25: r25.cups.s,   r25: r25.cups.r,   s26: r26.cups.s,   r26: r26.cups.r,   tgt25: hasCupsFc ? fcSumCat(fc25,cat,months,'cups',categoryMap) : null, tgt26: hasCupsFc ? fcSumCat(fc26,cat,months,'cups',categoryMap) : null },
    });
  }

  // ── product_data ──────────────────────────────────────────────
  const allCodes = new Set([...Object.keys(agg25.byProduct), ...Object.keys(agg26.byProduct)]);
  const product_data = [];
  for (const code of allCodes) {
    if (!code) continue;
    const r25 = resolve(agg25.byProduct[code] || newAcc());
    const r26 = resolve(agg26.byProduct[code] || newAcc());
    product_data.push({
      code,
      product:  productMap[code]  || code,
      category: categoryMap[code] || 'Unknown',
      ton:    { s25: r25.ton.s,    r25: r25.ton.r,    s26: r26.ton.s,    r26: r26.ton.r,    tgt25: fcSumCode(fc25,code,months,'ton'),    tgt26: fcSumCode(fc26,code,months,'ton')    },
      carton: { s25: r25.carton.s, r25: r25.carton.r, s26: r26.carton.s, r26: r26.carton.r, tgt25: fcSumCode(fc25,code,months,'carton'), tgt26: fcSumCode(fc26,code,months,'carton') },
      cups:   { s25: r25.cups.s,   r25: r25.cups.r,   s26: r26.cups.s,   r26: r26.cups.r,   tgt25: hasCupsFc ? fcSumCode(fc25,code,months,'cups') : null, tgt26: hasCupsFc ? fcSumCode(fc26,code,months,'cups') : null },
    });
  }

  // ── customer_data ─────────────────────────────────────────────
  const allCusts = new Set([...Object.keys(agg25.byCustomer), ...Object.keys(agg26.byCustomer)]);
  const custs25  = new Set(Object.keys(agg25.byCustomer));
  const customer_data = [];
  for (const cust of allCusts) {
    if (!cust) continue;
    const r25 = resolve(agg25.byCustomer[cust] || newAcc());
    const r26 = resolve(agg26.byCustomer[cust] || newAcc());
    customer_data.push({
      customer: cust,
      channel:  channelMap[cust] || 'Other',
      in_25:    custs25.has(cust),
      ton:    { s25: r25.ton.s,    r25: r25.ton.r,    s26: r26.ton.s,    r26: r26.ton.r    },
      carton: { s25: r25.carton.s, r25: r25.carton.r, s26: r26.carton.s, r26: r26.carton.r },
      cups:   { s25: r25.cups.s,   r25: r25.cups.r,   s26: r26.cups.s,   r26: r26.cups.r   },
    });
  }

  // ── channel_data ──────────────────────────────────────────────
  const allChs = new Set([...Object.keys(agg25.byChannel), ...Object.keys(agg26.byChannel)]);
  const channel_data = [];
  for (const ch of allChs) {
    if (!ch) continue;
    const r25 = resolve(agg25.byChannel[ch] || newAcc());
    const r26 = resolve(agg26.byChannel[ch] || newAcc());

    // Unique customers per channel per year
    const custs25ch = new Set(rows25.filter(r => months.includes(r.month) && r.channel === ch).map(r => r.customer));
    const custs26ch = new Set(rows26.filter(r => months.includes(r.month) && r.channel === ch).map(r => r.customer));

    // Monthly breakdown for channel
    const ch_monthly = MONTHS_FULL.map((name, idx) => {
      const m   = idx + 1;
      const cm25 = resolve(aggregateRows(rows25.filter(r => r.channel === ch), [m]).total);
      const cm26 = resolve(aggregateRows(rows26.filter(r => r.channel === ch), [m]).total);
      return { month_id: m, month_short: MONTHS_SHORT[idx],
        ton:    { s25: cm25.ton.s,    r25: cm25.ton.r,    s26: cm26.ton.s,    r26: cm26.ton.r    },
        carton: { s25: cm25.carton.s, r25: cm25.carton.r, s26: cm26.carton.s, r26: cm26.carton.r },
        cups:   { s25: cm25.cups.s,   r25: cm25.cups.r,   s26: cm26.cups.s,   r26: cm26.cups.r   },
      };
    });

    channel_data.push({
      channel: ch,
      customers_25: custs25ch.size,
      customers_26: custs26ch.size,
      ch_monthly,
      ton:    { s25: r25.ton.s,    r25: r25.ton.r,    s26: r26.ton.s,    r26: r26.ton.r    },
      carton: { s25: r25.carton.s, r25: r25.carton.r, s26: r26.carton.s, r26: r26.carton.r },
      cups:   { s25: r25.cups.s,   r25: r25.cups.r,   s26: r26.cups.s,   r26: r26.cups.r   },
    });
  }

  return { meta, monthly_data, category_data, product_data, customer_data, channel_data };
}

// ─────────────────────────────────────────────────────────────────
// Vercel Handler
// ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { months: mp, channel, category, customer } = req.query;
    const months = mp
      ? mp.split(',').map(Number).filter(n => n >= 1 && n <= 12)
      : [1, 2, 3, 4, 5, 6];

    const parsed = await getParsed();
    const data   = buildResponse(parsed, months, { channel, category, customer });

    // ── Validation log (compare with Power BI) ─────────────────
    const m = data.meta;
    console.table({
      Period:        m.period,
      Sales25_Ton:   +m.ton.s25.toFixed(2),
      Sales26_Ton:   +m.ton.s26.toFixed(2),
      Returns25_Ton: +m.ton.r25.toFixed(2),
      Returns26_Ton: +m.ton.r26.toFixed(2),
      Partial25_Ton: +m.ton.partial25.toFixed(2),
      Partial26_Ton: +m.ton.partial26.toFixed(2),
      Forecast26_Ton:+m.ton.tgt26.toFixed(2),
      Ach26_Ton:      m.ton.tgt26 > 0 ? (m.ton.s26 / m.ton.tgt26 * 100).toFixed(1) + '%' : 'N/A',
      Growth_Ton:     m.ton.s25  > 0 ? ((m.ton.s26 - m.ton.s25) / m.ton.s25 * 100).toFixed(1) + '%' : 'N/A',
      Sales26_Carton: +m.carton.s26.toFixed(2),
      Sales26_Cups:   +m.cups.s26.toFixed(2),
    });

    res.status(200).json(data);
  } catch (err) {
    console.error('[api/data] Error at step:', currentStep, err);
    res.status(500).json({
      success: false,
      step: currentStep,
      row: err.row || undefined,
      rowData: err.rowData || undefined,
      error: err.message,
      stack: err.stack
    });
  }
};
