// ── Wasteman — read-only AI assistant for the LPGP Tracker ──────────────────
// Admins ask questions in plain English / voice; Wasteman queries the live
// system (via the existing computed GET endpoints, so salary deductions etc.
// are already accounted for) and answers. Read-only: it only ever reads data.

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* dep not installed */ }

const MODEL = 'claude-opus-4-8';

// Read-only tools. Each maps to an existing GET endpoint; we forward the
// admin's auth cookie so all permission checks and computed logic are reused.
const TOOLS = [
  {
    name: 'get_salary_overview',
    description: 'Get the full salary overview for all employees for a given year. Returns each employee with: name, employment_type, currency, annual_salary, net_monthly, total_paid, net_remaining (how much is still owed for the year, AFTER all deductions), pct_paid (percent of the year\'s net target already paid), excess_deduction and total_office_deductions, and a payments[] list. Use this to answer anything about salaries, what is left to pay someone this year, who is unpaid, deductions, or payment history.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Calendar year, e.g. 2026. Defaults to the current year if omitted.' }
      }
    },
    _path: (input) => `/api/salary-overview?year=${encodeURIComponent(input.year || new Date().getFullYear())}`
  },
  {
    name: 'get_employees',
    description: 'List all employees with their core details: id, name, job_title, department, employment_type (payroll or self_employed), currency, start_date, active/terminated status, annual_salary and allowance_days. Use for questions about headcount, departments, roles, who works here, contract types, or to find an employee.',
    input_schema: { type: 'object', properties: {} },
    _path: () => `/api/employees/all`
  },
  {
    name: 'get_hotel_expenses',
    description: 'List hotel / venue / event expenses: event_name, hotel, event_year, currency, paid_amount, av_amount, cost (hotel cost estimate, may be text), and status (paid / partial / unpaid). Use for questions about hotel costs, what is outstanding on events, AV charges, or event spend.',
    input_schema: { type: 'object', properties: {} },
    _path: () => `/api/hotel-expenses`
  },
  {
    name: 'get_deals',
    description: 'List sales deals / revenue: amount, paid_inc_vat, tax_vat, status, client/event info. Use for questions about revenue, deals, what clients owe, or outstanding invoices.',
    input_schema: { type: 'object', properties: {} },
    _path: () => `/api/deals`
  },
  {
    name: 'get_attendance_summary',
    description: 'Get the attendance / days-off summary for every employee over a date range: days worked, days off, half days, and any deductions in that window. Use for questions about attendance, who took time off, or days-off counts.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' }
      },
      required: ['from', 'to']
    },
    _path: (input) => `/api/summary?from=${encodeURIComponent(input.from)}&to=${encodeURIComponent(input.to)}`
  }
];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are "Wasteman", the built-in AI assistant for LPGP Connect's internal management system (the LPGP Tracker). You help administrators by answering questions about the company's employees, salaries, attendance, hotel/event expenses, and deals.

Today's date is ${today}.

How you work:
- You can ONLY read data — you can never change, add, or delete anything. If asked to make a change, explain that you're read-only and tell them where in the app to do it.
- Always use your tools to fetch live data before answering. Never guess or rely on memory for figures.
- Salary figures from get_salary_overview already account for deductions: "net_remaining" is what is genuinely still owed for the year, and "pct_paid" already factors in office and day-off deductions. Use those fields directly — do not re-derive them.
- Currencies vary by employee (GBP £, AED, PHP ₱). Always show the employee's own currency with its symbol. Do not convert between currencies unless explicitly asked.
- When you reference money, format clearly (e.g. "£8,200").

Style:
- Be concise and direct — a sentence or two for simple questions. Lead with the number/answer, then a short bit of context if useful.
- Your replies may be read aloud by text-to-speech, so write in clean plain prose: no markdown tables, no asterisks, no bullet symbols. Short sentences.
- If a person's name is ambiguous (two matches), ask which one, or briefly give both.`;
}

// Call an internal GET endpoint, forwarding the admin's cookie.
async function callInternal(path, cookie, port) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: cookie ? { cookie } : {}
  });
  const text = await res.text();
  if (!res.ok) return { error: `Request failed (${res.status})`, detail: text.slice(0, 300) };
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
}

function registerWasteman(app, { requireAuth, requireAdmin, port }) {
  app.post('/api/wasteman', requireAuth, requireAdmin, async (req, res) => {
    if (!Anthropic) {
      return res.status(503).json({ error: 'Wasteman is not installed. Run "npm install" to add the @anthropic-ai/sdk dependency.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Wasteman needs an Anthropic API key. Set the ANTHROPIC_API_KEY environment variable on the server.' });
    }

    const cookie = req.headers.cookie || '';
    const history = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const question = (req.body?.question || '').toString();
    if (!history && !question.trim()) {
      return res.status(400).json({ error: 'Ask Wasteman a question.' });
    }

    // Build the message list: accept prior turns for context, else a single question.
    const messages = history
      ? history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
               .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
      : [{ role: 'user', content: question }];

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const toolDefs = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const toolByName = Object.fromEntries(TOOLS.map(t => [t.name, t]));

    try {
      let reply = '';
      for (let step = 0; step < 6; step++) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 2048,
          thinking: { type: 'adaptive' },
          system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
          tools: toolDefs,
          messages
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
          const toolResults = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            const tool = toolByName[block.name];
            let result;
            try {
              result = tool
                ? await callInternal(tool._path(block.input || {}), cookie, port)
                : { error: 'Unknown tool' };
            } catch (e) {
              result = { error: e.message };
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 60000)
            });
          }
          messages.push({ role: 'user', content: toolResults });
          continue; // let the model read the results and continue
        }

        // Terminal — collect text answer
        reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        break;
      }

      if (!reply) reply = "I couldn't work that out — try rephrasing the question.";
      res.json({ reply });
    } catch (e) {
      console.error('Wasteman error:', e.message);
      const msg = /api key|authentication/i.test(e.message)
        ? 'Wasteman could not authenticate with the AI service — check the ANTHROPIC_API_KEY.'
        : `Wasteman hit an error: ${e.message}`;
      res.status(500).json({ error: msg });
    }
  });
}

module.exports = { registerWasteman };
