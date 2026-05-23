import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // use service role key for server-side writes
);

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


    console.log('🔄 Pasul 2: Sync Supabase...');

    const chunkSize = 100;
    const existingMap = {};

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const { data: rows, error } = await supabase
        .from('products')
        .select('id, stock')
        .in('id', chunk);

      if (error) {
        console.error('❌ Eroare la fetch Supabase:', error.message);
        process.exit(1);
      }

      for (const row of rows || []) {
        existingMap[String(row.id)] = row;
      }
    }

    console.log(`📊 ${Object.keys(existingMap).length} produse deja în DB`);

    for (let i = 0; i < uniqueIds.length; i++) {
      const id = uniqueIds[i];
      const newStock = stockMap[id];
      const existing = existingMap[id];

      try {
        // Dacă există și stocul e același — skip
        if (existing && existing.stock === newStock) {
          totalSkipped++;
          continue;
        }

        // Dacă există și doar stocul s-a schimbat — updatează doar stocul
        if (existing && existing.stock !== newStock) {
          const { error } = await supabase
            .from('products')
            .update({ stock: newStock })
            .eq('id', id);

          if (error) throw error;

          totalUpdated++;
          console.log(`🔄 [${i + 1}/${uniqueIds.length}] Stoc actualizat: ID ${id} ${existing.stock} → ${newStock}`);
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
        const coverImage = detail.images?.[0]?.uri || '';
        const today = new Date().toISOString().split('T')[0];

        const productData = {
          id: Number(id),
          title: detail.title || '',
          title_lowercase: (detail.title || '').toLowerCase(),
          artist: artistName,
          artist_lowercase: artistName.toLowerCase(),
          year: Number(detail.year) || 0,
          country: detail.country || '',
          format: detail.formats?.[0]?.name || '',
          format_desc: detail.formats?.[0]?.descriptions?.[0] || '',
          price: 0,
          stock: newStock,
          cover_image: coverImage,
          thumb: detail.images?.[0]?.uri_150 || coverImage,
          label: detail.labels?.[0]?.name || '',
          genres: detail.genres || [],
          styles: detail.styles || [],
          images: detail.images?.map(img => img.uri) || [],
          date_added: new Date().toISOString(),
          stare_coperta: '',
          stare_disc: '',
          oferta_activa: false,
          oferta_procent: '',
          oferta_data_start: today,
          oferta_data_end: today,
          barcode: '',
        };

        const { error } = await supabase
          .from('products')
          .insert(productData);

        if (error) throw error;

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