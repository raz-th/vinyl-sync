// server/index.js
import express from 'express';
import cron from 'node-cron';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import 'dotenv/config';

initializeApp({
  credential: cert(JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))),
});

const firestore = getFirestore();
const app = express();

const cleanName = (name) => name.replace(/\s*\(\d+\)$/, '').trim();

const syncCollection = async () => {
  console.log('🔄 Sync pornit...', new Date().toISOString());
  let page = 1, totalPages = 1, totalSaved = 0;

  try {
    do {
      const res = await fetch(
        `https://api.discogs.com/users/${process.env.DISCOGS_USERNAME}/collection/folders/0/releases?per_page=500&page=${page}&sort=added`,
        {
          headers: {
            Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
            'User-Agent': 'MyVinylApp/1.0',
          },
        }
      );

      const data = await res.json();
      totalPages = data.pagination.pages;

      const batch = firestore.batch();
      for (const r of data.releases) {
        const info = r.basic_information;
        const ref = firestore.collection('releases').doc(String(info.id));
        batch.set(ref, {
          id: info.id,
          title: info.title,
          artist: info.artists?.map(a => cleanName(a.name)).join(', '),
          year: info.year || null,
          genres: info.genres || [],
          styles: info.styles || [],
          cover_image: info.cover_image || '',
          thumb: info.thumb || '',
          label: info.labels?.[0]?.name || '',
          format: info.formats?.[0]?.name || '',
          format_desc: info.formats?.[0]?.descriptions?.[0] || '',
          date_added: r.date_added,
        }, { merge: true });
      }
      await batch.commit();

      totalSaved += data.releases.length;
      console.log(`✅ Pagina ${page}/${totalPages} — ${totalSaved} discuri`);
      page++;

      await new Promise(r => setTimeout(r, 1100));
    } while (page <= totalPages);

    console.log(`🎉 Sync complet! ${totalSaved} discuri salvate.`);
  } catch (err) {
    console.error('❌ Eroare sync:', err.message);
  }
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/sync', async (req, res) => {
  res.json({ message: 'Sync pornit' });
  await syncCollection();
});

// cron: la fiecare 2 zile la ora 03:00
cron.schedule('0 3 */2 * *', syncCollection);

app.listen(process.env.PORT || 4000, () => {
  console.log('🎵 Server pornit');
  syncCollection(); // sync la prima pornire
});