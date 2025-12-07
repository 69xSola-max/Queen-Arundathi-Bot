const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const readline = require("readline");
const qrcode = require('qrcode-terminal');
const { botName, prefix } = require('./config'); // ownerNumber එක අපි මැනුවලි ගහන නිසා මෙතනින් අයින් කළා

const slotEmojis = ["🍇", "🍉", "🍊", "🍎", "🍓", "🍒", "💎"];

// User Input ලබා ගැනීමට
const question = (text) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    const { version } = await fetchLatestBaileysVersion();
    
    let usePairing = false;
    let inputNumber = ""; // මැනුවලි ගහන නම්බර් එක මෙතනට එනවා

    // බොට් තාම ලියාපදිංචි වී නැත්නම් පමණක් මෙය අසයි
    if (!state.creds.registered) {
        console.clear();
        console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  CONNECT METHOD SELECTOR ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 1. 📷 QR Code
 2. 🔢 Pairing Code
`);
        const method = await question("ඔබට අවශ්‍ය ක්‍රමයේ අංකය ගසන්න (1 හෝ 2): ");
        
        if (method.trim() === "2") {
            usePairing = true;
            // මෙන්න මෙතනදී අපි නම්බර් එක අහනවා
            inputNumber = await question("\nඔබගේ WhatsApp අංකය ලබා දෙන්න (උදා: 9477xxxxxxx): ");
        }
    }

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !usePairing, // Pairing එපා නම් QR පෙන්වන්න
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Pairing Code අවශ්‍ය නම් සහ නම්බර් එක දීලා තියෙනවා නම්
    if (usePairing && !sock.authState.creds.registered && inputNumber) {
        setTimeout(async () => {
            try {
                // ඔබ ටයිප් කළ නම්බර් එකට කෝඩ් එක යවයි
                const code = await sock.requestPairingCode(inputNumber);
                console.log(`\n\n🟢 YOUR PAIRING CODE: ${code?.match(/.{1,4}/g)?.join("-") || code}\n\n`);
            } catch (e) { 
                console.log("⚠️ Pairing Code දෝෂයක්. අංකය නිවැරදිදැයි පරීක්ෂා කරන්න."); 
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // QR Code එක පෙන්වන කොටස (Pairing නැත්නම් පමණයි)
        if (qr && !usePairing) {
            console.log("\nScan this QR Code via WhatsApp:\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
            else console.log("Session Expired. Please delete session_auth and restart.");
        } else if (connection === 'open') {
            console.log(`✅ ${botName} IS ONLINE!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const messageType = Object.keys(msg.message)[0];
            const from = msg.key.remoteJid;

            // Anti-View Once
            if (messageType === 'viewOnceMessageV2' || messageType === 'viewOnceMessage') {
                const viewOnceMsg = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
                const type = Object.keys(viewOnceMsg)[0];
                if (type === 'imageMessage' || type === 'videoMessage') {
                    const buffer = await downloadMediaMessage({ key: msg.key, message: viewOnceMsg }, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    if (type === 'imageMessage') await sock.sendMessage(from, { image: buffer, caption: "Saved by Bot" });
                    else if (type === 'videoMessage') await sock.sendMessage(from, { video: buffer, caption: "Saved by Bot" });
                    return;
                }
            }

            const text = messageType === 'conversation' ? msg.message.conversation : messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';
            if (!text.startsWith(prefix)) return;
            const command = text.slice(1).split(' ')[0].toLowerCase();
            const args = text.split(' ').slice(1).join(' ');

            switch (command) {
                case 'alive':
                    await sock.sendMessage(from, { image: { url: "https://ibb.co/xKGZh2MQ" }, caption: `👋 *I am Online!*` }, { quoted: msg });
                    break;
                case 'menu':
                    await sock.sendMessage(from, { image: { url: "https://telegra.ph/file/54efddccf41281ad7ec51.jpg" }, caption: "MENU:\n.song\n.movie\n.777\n.alive" }, { quoted: msg });
                    break;
                case '777':
                     const s = slotEmojis[Math.floor(Math.random() * slotEmojis.length)];
                     await sock.sendMessage(from, { text: `🎰 ${s} | ${s} | ${s} \n JACKPOT!` }, { quoted: msg });
                     break;
                case 'song':
                    if(!args) return sock.sendMessage(from, { text: "Link?" }, { quoted: msg });
                    try {
                        let stream = ytdl(args, { filter: 'audioonly', quality: 'highestaudio' });
                        const f = `./song.mp3`;
                        const ws = fs.createWriteStream(f);
                        stream.pipe(ws);
                        ws.on('finish', async () => { await sock.sendMessage(from, { audio: fs.readFileSync(f), mimetype: 'audio/mp4', ptt: false }, { quoted: msg }); fs.unlinkSync(f); });
                    } catch(e) { await sock.sendMessage(from, { text: "Error" }, { quoted: msg }); }
                    break;
                case 'movie':
                    if(!args) return sock.sendMessage(from, { text: "Name?" }, { quoted: msg });
                    try {
                        const r = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${args}`);
                        if (r.data.data.movie_count > 0) await sock.sendMessage(from, { image: { url: r.data.data.movies[0].medium_cover_image }, caption: `🎬 ${r.data.data.movies[0].title_long}\n🔗 ${r.data.data.movies[0].torrents[0].url}` }, { quoted: msg });
                        else await sock.sendMessage(from, { text: "Not Found" }, { quoted: msg });
                    } catch(e) { await sock.sendMessage(from, { text: "Error" }, { quoted: msg }); }
                    break;
            }
        } catch (e) { console.log("Error:", e); }
    });
    return sock;
}
startBot();
