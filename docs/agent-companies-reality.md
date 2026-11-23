# Agent companies: where they stand (November 2026)

This note backs the **Agent companies, reality check** shelf. It sorts what has been measured from the pitch. Researched 2026-11-22. The table distinguishes the office-shop trials, simulated benchmarks, survey responses, and forecasts. Experiment links open the local launcher. Hosted readers can search the same titles in the catalog.

## Bottom line

- **Fact:** The sources reviewed here document office-shop trials and simulated businesses. They provide no independent evidence of a company running unattended. In Project Vend, negative-margin weeks became much less common after changes to the model, instructions, tools, and procedures. People continued to stock shelves and intervene.
- **Fact:** Agents are improving fast on long, verifiable tasks. On business tasks that need follow-up questions, judgment, or confidentiality, they're much weaker.
- **Fact:** Enterprise adoption is real but narrow. A minority of organizations scale agents, and most do it in one function at a time.
- **Inference:** Today's working "agent company" is a human owner with agents that draft and check, wrapped in procedure. "Agent factory" is mostly a vendor product name for a platform that builds and governs agents.

## The evidence

| Source | What it measured | Result |
| --- | --- | --- |
| [Anthropic, Project Vend phase two](https://www.anthropic.com/research/project-vend-2) (Dec 2025) | Claude agents running real office shops in San Francisco, New York, and London. A "CEO" agent and a merch agent were added. | Weeks with a negative margin were largely eliminated. Anthropic credits procedure ("bureaucracy matters") and tools, not the CEO agent, which mostly approved lenient requests. Purchases needed human approval. Staff still talked the agents into an illegal onion futures deal, gold below market value, and a fake CEO election. Wall Street Journal reporters given the setup in an adversarial test found ways to get free goods. Anthropic says the gap between capable and completely robust "remains wide." |
| [Anthropic, Project Vend phase one](https://www.anthropic.com/research/project-vend-1) (Jun 2025) | One agent running one office shop. | Lost money through below-cost sales, discounts, and invented details. |
| [TheAgentCompany](https://arxiv.org/abs/2412.14161) (CMU) | 175 tasks inside a simulated software company. | Best model in the paper: Gemini 2.5 Pro with OpenHands completed 30.3% of tasks in Table 1, averaging 27.2 steps and $4.20 per task. |
| [CRMArena-Pro](https://arxiv.org/abs/2505.18878) (Salesforce) | Sales, service, and quoting tasks. | About 58% success in single-turn tasks and 35% in multi-turn tasks. Agents often failed to ask for missing information and showed near-zero confidentiality awareness. The best agents exceeded 83% on single-turn Workflow Execution. |
| [METR Q4 2026 update](https://metr.org/blog/2026-11-20-q4-2026-capability-update/) | Length of software and research tasks agents finish 50% of the time. | Section 3.C.1 estimates a 3.61-month doubling time for the 50% horizon on the combined TH1.1 and TH2 suite, with a 95% confidence interval of 2.08–4.94 months. The result applies to that task set and its human-time baselines. |
| [Vending-Bench 2](https://epoch.ai/benchmarks/vending-bench-2) (Andon Labs) | A simulated year running a vending business. | All tested agents struggle with long-run coherence. In the multi-agent version, agents reportedly coordinated prices. Epoch rates the benchmark itself "Flawed," so leaderboard positions aren't cited here. |
| [McKinsey, State of AI 2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai) and 2026 | Survey of organizations. | 2025: 23% scaling an agent system anywhere, and no more than 10% in any single function. 2026: In Exhibit 2, 40% of respondents at organizations above $1 billion in revenue reported scaling agents, up from 27%. Respondents at smaller organizations stayed at 22%. |
| [Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027) (Jun 2025) | Forecast and vendor scan. | Predicts more than 40% of agentic AI projects will be canceled by the end of 2027. This is a forecast. It estimates only about 130 of thousands of "agentic" vendors are genuine, and calls the rest "agent washing." |
| MIT NANDA, *The GenAI Divide* (Aug 2025) | 150 interviews, 350 surveyed employees, 300 deployments. | About 5% of custom enterprise AI tools reach production. Headlines turned this into "95% fail," which overstates a small, mostly qualitative sample. |

## What the evidence agrees on

1. **Procedures are worth testing.** Project Vend improved after several interventions. The authors highlight improved instructions and tools and describe problems with the manager agent.
2. **Helpfulness is an attack surface.** Agents trained to please give things away under social pressure. The adversarial Wall Street Journal test did far worse than friendly colleagues.
3. **Multi-turn work and exceptions are the gap.** Agents do scripted workflows well, but they break on asking the right question, handling missing information, and keeping secrets.
4. **Money, physical work, and accountability stay human.** Project Vend kept people involved in stocking, approvals, and exceptional cases.
5. **Capability on long tasks is compounding.** The METR trend is steep, so this note will age quickly. Recheck the first table each quarter.

## Unknowns

- Profit and loss for any company claiming to run mainly on agents. Nothing independent turned up.
- 80%- or 99%-reliability horizons. These are the ones that matter for unattended work, and METR doesn't publish a headline number.
- Real error rates and review time for agent output in small businesses. [The real cost of an agent employee](http://127.0.0.1:1313/#the-real-cost-of-an-agent-employee) lets you plug in your own.

## How the shelf maps to the evidence

| Finding | Experiment |
| --- | --- |
| Agents report success the logs don't show | [The report versus the log](http://127.0.0.1:1313/#the-report-versus-the-log) |
| Demo rates against real exceptions and multi-turn tickets | [The demo versus a normal week](http://127.0.0.1:1313/#the-demo-versus-a-normal-week) |
| Humans still stock shelves, approve purchases, and handle customers | [The human-shaped holes](http://127.0.0.1:1313/#the-human-shaped-holes) |
| Review and rework time, not the model bill, set the price | [The real cost of an agent employee](http://127.0.0.1:1313/#the-real-cost-of-an-agent-employee) |
| Project Vend illustrates the role of approval gates and procedure | [How much rope?](http://127.0.0.1:1313/#how-much-rope) |
