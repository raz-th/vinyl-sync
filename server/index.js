import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const firestore = getFirestore();
const cleanName = (name) => name.replace(/\s*\(\d+\)$/, '').trim();

const syncCollection = async () => {
  console.log('🔄 Sync pornit...', new Date().toISOString());
  let page = 1, totalPages = 1, totalSaved = 0;

  try {
    do {
      const res = await fetch(
        `https://api.discogs.com/users/${process.env.DISCOGS_USERNAME}/collection/folders/1/releases?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
            'User-Agent': 'MyVinylApp/1.0',
          },
        }
      );

      const data = await res.json();
      console.log('status:', res.status);
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
    process.exit(0);
  } catch (err) {
    console.error('❌ Eroare:', err.message);
    process.exit(1);
  }
};

syncCollection();