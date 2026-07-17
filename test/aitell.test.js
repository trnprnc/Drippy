// Run: node test/aitell.test.js
const { scanAiTell } = require('../aitell');

const AI_TEXT_1 = `I hope this email finds you well. I wanted to reach out regarding the proposal — it's important to note that our approach delivers seamless integration across your workflow. Furthermore, the platform is designed to unlock the full potential of your team — enabling productivity gains at every stage. It's not just a tool, but a comprehensive solution for the modern workplace.`;

const AI_TEXT_2 = `Our platform delivers robust analytics for growing teams today — built for scale. The dashboard provides clear insights into user engagement daily. Reports are generated automatically for every single campaign. Metrics are tracked across channels with total accuracy always. Insights are surfaced quickly for every stakeholder involved — no setup required. Decisions are supported by data at every level throughout.`;

const HUMAN_TEXT = `Jack, quick one. Saw the demo yesterday and honestly? Bit underwhelmed. The onboarding is clunky. Three clicks to get to the thing people actually want. BUT the trends view is lovely and I think we bury it. Can we chat Thursday? I've got a wild idea about the pricing page (you'll hate it, then you'll love it).`;

const HUMAN_TEXT_2 = `The build failed twice on CI but passes locally. I think it's the node version mismatch again. Pinning to 20.11 fixed it last time so I've done the same and re-run. If it's still red after this, look at the cache step. Lunch?`;

const cases = [
  ['AI marketing email', AI_TEXT_1, true],
  ['AI uniform-rhythm text', AI_TEXT_2, true],
  ['human casual email', HUMAN_TEXT, false],
  ['human dev note', HUMAN_TEXT_2, false],
  ['too-short text', 'Short note — thanks!', false],
];

let fails = 0;
for (const [name, text, shouldFire] of cases) {
  const { score, signals } = scanAiTell(text);
  const fired = score >= 3;
  if (fired !== shouldFire) {
    fails++;
    console.log(`FAIL: ${name} → score ${score} [${signals}] expected fire=${shouldFire}`);
  }
}
console.log(fails === 0 ? `all ${cases.length} aitell cases pass` : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
