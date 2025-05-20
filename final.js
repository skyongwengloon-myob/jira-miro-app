require('dotenv').config();
const axios = require('axios');

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_TOKEN;
const JIRA_BOARD_ID = process.env.JIRA_BOARD_ID;
const MIRO_TOKEN = process.env.MIRO_TOKEN;
const MIRO_BOARD_ID = process.env.MIRO_BOARD_ID;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

const JIRA_AUTH = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;

async function getSprints() {
  const res = await axios.get(`${JIRA_BASE_URL}/rest/agile/1.0/board/${JIRA_BOARD_ID}/sprint?state=active,closed`, {
    headers: { Authorization: JIRA_AUTH }
  });

  const sprints = res.data.values;
  const closed = sprints.filter(s => s.state === 'closed').sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
  const active = sprints.find(s => s.state === 'active');
  return [...closed.slice(0, 4).reverse(), active];
}

async function getSprintStats(sprintId) {
  const res = await axios.get(`${JIRA_BASE_URL}/rest/agile/1.0/sprint/${sprintId}/issue`, {
    headers: { Authorization: JIRA_AUTH }
  });

  const issues = res.data.issues;
  const total = issues.length;
  const done = issues.filter(i => i.fields.status.statusCategory.key === 'done').length;

  return { total, done };
}

async function createMiroTable(tableData) {
  const cellWidth = 150;
  const cellHeight = 50;
  const startX = -((tableData[0].length / 2) * cellWidth);
  const startY = -((tableData.length / 2) * cellHeight);

  const promises = [];

  tableData.forEach((row, rowIndex) => {
    row.forEach((text, colIndex) => {
      promises.push(
        axios.post(`https://api.miro.com/v2/boards/${MIRO_BOARD_ID}/shapes`, {
          data: { content: text },
          position: {
            origin: 'center',
            x: startX + colIndex * cellWidth,
            y: startY + rowIndex * cellHeight,
          },
          geometry: { width: cellWidth, height: cellHeight }
        }, {
          headers: {
            Authorization: `Bearer ${MIRO_TOKEN}`,
            'Content-Type': 'application/json'
          }
        })
      );
    });
  });

  await Promise.all(promises);
  console.log('Miro table created successfully.');
}

// Build a burn-up chart config based on your Jira sprint data
function buildBurnupChartConfig(table) {
  const labels = table.slice(1).map(row => row[0]); // Sprint names
  const totalScope = table.slice(1).map(row => Number(row[1])); // Total issues
  const doneData = table.slice(1).map(row => Number(row[2])); // Done per sprint
  const cumulativeDone = table.slice(1).map(row => Number(row[3])); // Cumulative done

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Done (per sprint)',
          data: doneData,
          borderColor: 'green',
          fill: false,
          tension: 0.3
        },
        {
          label: 'Cumulative Done',
          data: cumulativeDone,
          borderColor: 'blue',
          fill: false,
          tension: 0.3
        },
        {
          label: 'Scope (Total)',
          data: totalScope,
          borderColor: 'red',
          borderDash: [5, 5],
          fill: false,
          tension: 0.3
        }
      ]
    },
    options: {
      plugins: {
        backgroundColor: 'white',
        title: {
          display: true,
          text: 'Jira Sprint Burn-Up Chart'
        }
      },
      scales: {
        y: { beginAtZero: true }
      }
    },
    backgroundColor: 'white',
  };
}

// Upload chart image to Miro
async function uploadChartToMiro(chartConfig) {
  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  const res = await axios.post(`https://api.miro.com/v2/boards/${MIRO_BOARD_ID}/images`, {
    data: { url: chartUrl },
    position: { origin: 'center', x: 1000, y: 0 }
  }, {
    headers: { Authorization: `Bearer ${MIRO_TOKEN}`, 'Content-Type': 'application/json' }
  });

  console.log('Chart uploaded to Miro:', res.data.id);
}

(async () => {
  try {
    const sprints = await getSprints();
    const table = [['Sprint', 'Total', 'Done', 'Cumulative Done']];
    let cumulativeDone = 0;

    for (const sprint of sprints) {
      const { total, done } = await getSprintStats(sprint.id);
      cumulativeDone += done;
      table.push([sprint.name, total.toString(), done.toString(), cumulativeDone.toString()]);
    }

    await createMiroTable(table);

    const chartConfig = buildBurnupChartConfig(table);
    await uploadChartToMiro(chartConfig);

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
})();
