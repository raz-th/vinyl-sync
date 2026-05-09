import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const firestore = getFirestore();
const cleanName = (name) => name.replace(/\s*\(\d+\)$/, '').trim();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const syncCollection = async () => {
  console.log('🔄 Sync pornit...', new Date().toISOString());
  let page = 1, totalPages = 1;
  let totalAdded = 0, totalUpdated = 0, totalSkipped = 0;

  const stockMap = {};

  try {
    // PASUL 1: Calculează stocul din colecție
    console.log('📦 Pasul 1: Calculez stocul...');
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

      if (!res.ok) {
        console.error(`❌ Eroare Discogs collection: HTTP ${res.status}`);
        process.exit(1);
      }

      const data = await res.json();
      totalPages = data.pagination.pages;

      for (const r of data.releases) {
        const id = String(r.basic_information.id);
        stockMap[id] = (stockMap[id] || 0) + 1;
      }

      console.log(`📄 Pagina ${page}/${totalPages}`);
      page++;
      await sleep(1100);
    } while (page <= totalPages);

    const uniqueIds = Object.keys(stockMap);
    console.log(`✅ ${uniqueIds.length} produse unice găsite`);

    // PASUL 2: Procesează în batch-uri de 100
    console.log('🔄 Pasul 2: Sync Firebase...');

    // Preia toate doc-urile existente dintr-o singură cerere
    const existingDocs = {};
    const allRefs = uniqueIds.map(id => firestore.collection('releases').doc(id));

    // Firestore getAll acceptă max 500 doc-uri
    const chunkSize = 500;
    for (let i = 0; i < allRefs.length; i += chunkSize) {
      const chunk = allRefs.slice(i, i + chunkSize);
      const snaps = await firestore.getAll(...chunk);
      for (const snap of snaps) {
        existingDocs[snap.id] = snap.exists ? snap.data() : null;
      }
    }

    console.log(`📊 ${Object.values(existingDocs).filter(Boolean).length} produse deja în DB`);

    for (let i = 0; i < uniqueIds.length; i++) {
      const id = uniqueIds[i];
      const newStock = stockMap[id];
      const existing = existingDocs[id];

      try {
        // Dacă există și stocul e același — skip
        if (existing && existing.stock === newStock) {
          totalSkipped++;
          continue;
        }

        // Dacă există și doar stocul s-a schimbat — updatează doar stocul
        if (existing && existing.stock !== newStock) {
          await firestore.collection('releases').doc(id).update({ stock: newStock });
          totalUpdated++;
          console.log(`🔄 [${i + 1}/${uniqueIds.length}] Stoc actualizat: "${existing.title}" ${existing.stock} → ${newStock}`);
          await sleep(200);
          continue;
        }

        // Produs nou — fetch detalii și salvează complet
        const detailRes = await fetch(
          `https://api.discogs.com/releases/${id}`,
          {
            headers: {
              Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
              'User-Agent': 'MyVinylApp/1.0',
            },
          }
        );

        if (!detailRes.ok) {
          console.warn(`⚠️  Release ${id} — HTTP ${detailRes.status}, skip`);
          continue;
        }

        const detail = await detailRes.json();
        const artistName = detail.artists?.map(a => cleanName(a.name)).join(', ') || '';

        await firestore.collection('releases').doc(id).set({
          id: Number(id),
          title: detail.title || '',
          title_lowercase: (detail.title || '').toLowerCase(),
          artist: artistName,
          artist_lowercase: artistName.toLowerCase(),
          year: detail.year || null,
          country: detail.country || '',
          genres: detail.genres || [],
          styles: detail.styles || [],
          cover_image: detail.images?.[0]?.uri || '',
          thumb: detail.images?.[0]?.uri_150 || '',
          label: detail.labels?.[0]?.name || '',
          format: detail.formats?.[0]?.name || '',
          format_desc: detail.formats?.[0]?.descriptions?.[0] || '',
          date_added: new Date().toISOString(),
          stock: newStock,
          price: 0,
        });

        totalAdded++;
        console.log(`✅ [${i + 1}/${uniqueIds.length}] Adăugat: "${detail.title}" — stoc: ${newStock}`);
        await sleep(1100);

      } catch (err) {
        console.error(`❌ Eroare la release ${id}:`, err.message);
      }
    }

    console.log(`\n🎉 Sync complet!`);
    console.log(`   ✅ Adăugate: ${totalAdded}`);
    console.log(`   🔄 Actualizate: ${totalUpdated}`);
    console.log(`   ⏭️  Sărite: ${totalSkipped}`);
    process.exit(0);

  } catch (err) {
    console.error('❌ Eroare generală:', err.message);
    process.exit(1);
  }
};

syncCollection();