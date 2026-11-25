export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export default async function handler(req, res) {
  // Pengaturan CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Custom-Api-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method tidak diizinkan. Gunakan POST.' });
  }

  try {
    const { image, scale = 4, faceEnhance = true, creativity = 0.35, modelType = 'esrgan' } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Data gambar tidak ditemukan.' });
    }

    // Mengambil API Key dari Vercel Environment Variable atau kunci uji coba dari header
    const apiToken = process.env.REPLICATE_API_TOKEN || req.headers['x-custom-api-key'];

    if (!apiToken) {
      return res.status(401).json({
        error: 'API Key Cloud GPU belum dikonfigurasi. Tambahkan REPLICATE_API_TOKEN di Vercel Environment Variables atau masukkan kunci sementara di menu Pengaturan API.',
      });
    }

    // Pemilihan Model AI Cloud (Real-ESRGAN 4x+ atau Clarity Generative Upscaler)
    const modelVersion =
      modelType === 'clarity'
        ? 'dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e' // Clarity Upscaler
        : 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa'; // Real-ESRGAN 4x+

    const inputPayload =
      modelType === 'clarity'
        ? {
            image,
            scale_factor: Math.min(Number(scale), 4),
            creativity: Number(creativity),
            resemblance: 0.85,
            prompt: 'masterpiece, ultra high resolution, sharp focus, intricate textures, photorealistic, 8k uhd',
            negative_prompt: 'blurry, artifacts, noise, pixelated, low quality, distorted',
          }
        : {
            image,
            scale: Math.min(Number(scale), 8),
            face_enhance: Boolean(faceEnhance),
          };

    // Mengirim tugas ke Replicate API
    const startResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=55', // Menunggu hasil langsung hingga 55 detik
      },
      body: JSON.stringify({
        version: modelVersion,
        input: inputPayload,
      }),
    });

    const prediction = await startResponse.json();

    if (!startResponse.ok) {
      return res.status(startResponse.status).json({
        error: prediction.detail || 'Gagal memproses gambar di Cloud GPU.',
      });
    }

    // Jika hasil sudah langsung selesai (mode synchronous Prefer: wait)
    if (prediction.status === 'succeeded' && prediction.output) {
      const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return res.status(200).json({ outputUrl, status: 'succeeded' });
    }

    // Polling jika gambar berukuran sangat besar dan butuh waktu ekstra
    let currentPrediction = prediction;
    let attempts = 0;
    while (
      currentPrediction.status !== 'succeeded' &&
      currentPrediction.status !== 'failed' &&
      attempts < 20
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const pollRes = await fetch(currentPrediction.urls.get, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      currentPrediction = await pollRes.json();
      attempts++;
    }

    if (currentPrediction.status === 'succeeded') {
      const outputUrl = Array.isArray(currentPrediction.output)
        ? currentPrediction.output[0]
        : currentPrediction.output;
      return res.status(200).json({ outputUrl, status: 'succeeded' });
    }

    return res.status(500).json({
      error: currentPrediction.error || 'Waktu pemrosesan habis atau terjadi kesalahan pada GPU.',
    });
  } catch (err) {
    return res.status(500).json({ error: `Server Error: ${err.message}` });
  }
}