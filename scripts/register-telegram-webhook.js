require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is missing in .env.local');
    process.exit(1);
  }

  const vercelUrl = process.env.VERCEL_URL || 'ignition-portfolio.vercel.app';
  const webhookUrl = `https://${vercelUrl}/api/telegram-webhook`;

  console.log('Registering webhook at:', webhookUrl);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl })
  });

  const data = await res.json();

  if (data.ok) {
    console.log('✅ Telegram webhook registered successfully!');
    console.log('Webhook URL:', webhookUrl);
    console.log('\nNow reply to any Kai lead notification on Telegram.');
    console.log('Kai will respond as your personal assistant!');
  } else {
    console.error('❌ Failed to register webhook:', data.description);
  }
}

run().catch(console.error);
