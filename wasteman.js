// ── Wasteman — read-only AI assistant for the LPGP Tracker ──────────────────
// Admins ask questions in plain English / voice; Wasteman calls the provided
// database functions directly (no HTTP round-trip) and answers. Read-only.

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* dep not installed */ }

const MODEL = 'claude-sonnet-4-6';

const TOOL_DEFS = [
  {
    name: 'get_salary_overview',
    description: 'Get the full salary overview for all employees for a given year. Returns each employee with: name, employment_type, currency, annual_salary, net_monthly, total_paid, net_remaining (how much is still owed for the year, AFTER all deductions), pct_paid (percent of the year\'s net target already paid), excess_deduction, total_office_deductions, and a payments[] list. Use this to answer anything about salaries, what is left to pay someone, who is unpaid, deductions, or payment history.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Calendar year, e.g. 2026. Defaults to current year if omitted.' }
      }
    }
  },
  {
    name: 'get_employees',
    description: 'List all employees with core details: id, name, job_title, department, employment_type (payroll or self_employed), currency, start_date, active status, annual_salary. Use for questions about headcount, departments, roles, who works here, or to look up an employee.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_hotel_expenses',
    description: 'List hotel / venue / event expenses: event_name, hotel, event_year, currency, paid_amount, av_amount, cost (estimate, may be text), and status (paid / partial / unpaid). Use for questions about hotel costs, outstanding event spend, AV charges.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_deals',
    description: 'List sales deals / revenue: amount, paid_inc_vat, tax_vat, status, client / event info. Use for questions about revenue, deals, outstanding invoices.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_attendance_summary',
    description: 'Get the attendance / days-off summary for every active employee over a date range: days worked, days off, excess days, and deductions in that window. Use for questions about attendance, who took time off, or days-off counts.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to:   { type: 'string', description: 'End date YYYY-MM-DD' }
      },
      required: ['from', 'to']
    }
  }
];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are "Wasteman", the built-in AI assistant for LPGP Connect's internal management system. You help administrators answer questions about employees, salaries, attendance, hotel/event expenses, and deals.

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

function registerWasteman(app, { requireAuth, requireAdmin, db }) {
  app.post('/api/wasteman', requireAuth, requireAdmin, async (req, res) => {
    if (!Anthropic) {
      return res.status(503).json({ error: 'Wasteman needs the @anthropic-ai/sdk package. Run "npm install" on the server.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Wasteman needs an ANTHROPIC_API_KEY environment variable set on the server.' });
    }

    const history  = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const question = (req.body?.question || '').toString();
    if (!history && !question.trim()) {
      return res.status(400).json({ error: 'Ask Wasteman a question.' });
    }

    const messages = history
      ? history
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
          .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
      : [{ role: 'user', content: question }];

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    try {
      let reply = '';
      for (let step = 0; step < 6; step++) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
          tools: TOOL_DEFS,
          messages
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
          const toolResults = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            let result;
            try {
              const year = block.input?.year || new Date().getFullYear();
              if (block.name === 'get_salary_overview') {
                result = await db.getSalaryOverview(year);
              } else if (block.name === 'get_employees') {
                result = await db.getEmployees();
              } else if (block.name === 'get_hotel_expenses') {
                result = await db.getHotelExpenses();
              } else if (block.name === 'get_deals') {
                result = await db.getDeals();
              } else if (block.name === 'get_attendance_summary') {
                result = await db.getAttendanceSummary(block.input?.from, block.input?.to);
              } else {
                result = { error: 'Unknown tool: ' + block.name };
              }
            } catch (e) {
              console.error('Wasteman tool error:', block.name, e.message);
              result = { error: e.message };
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 60000)
            });
          }
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

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
