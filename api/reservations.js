import { createClient } from 'redis';

// 连接Redis，带错误处理
let client;
try {
  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });
  
  client.on('error', (err) => {
    console.log('Redis Client Error:', err);
  });
} catch (e) {
  console.log('Redis init error:', e);
}

const KEY = 'cell_reservations';

async function getClient() {
  if (!client) throw new Error('Redis not initialized');
  if (!client.isReady) {
    await client.connect();
  }
  return client;
}

async function cleanExpired() {
  try {
    const now = Date.now();
    const redis = await getClient();
    const data = await redis.get(KEY);
    const all = data ? JSON.parse(data) : [];
    const valid = all.filter(r => new Date(r.end).getTime() > now);
    if (valid.length !== all.length) {
      await redis.set(KEY, JSON.stringify(valid));
    }
    return valid;
  } catch (e) {
    console.error('Clean error:', e);
    return []; // 出错时返回空数组，不影响页面显示
  }
}

export default async function handler(req, res) {
  // 设置CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = await cleanExpired();
      return res.json(data);
    }
    
    if (req.method === 'POST') {
      const { name, start, end } = req.body;
      
      if (!name || !start || !end) {
        return res.status(400).json({ error: '缺少必要信息' });
      }
      
      const all = await cleanExpired();
      
      // 检查时间冲突
      const conflict = all.some(r => {
        return new Date(r.start) < new Date(end) && 
               new Date(r.end) > new Date(start);
      });
      
      if (conflict) {
        return res.status(409).json({ error: '该时间段已被他人预约' });
      }
      
      const newItem = {
        id: Date.now().toString(),
        name: name.trim(),
        start, 
        end,
        createdAt: new Date().toISOString()
      };
      
      all.push(newItem);
      const redis = await getClient();
      await redis.set(KEY, JSON.stringify(all));
      
      return res.status(201).json(newItem);
    }
    
    if (req.method === 'DELETE') {
      const { id, name } = req.query;
      
      if (!id || !name) {
        return res.status(400).json({ error: '缺少参数' });
      }
      
      const all = await cleanExpired();
      const idx = all.findIndex(r => r.id === id && r.name === name.trim());
      
      if (idx === -1) {
        return res.status(403).json({ error: '只能取消自己的预约' });
      }
      
      all.splice(idx, 1);
      const redis = await getClient();
      await redis.set(KEY, JSON.stringify(all));
      
      return res.json({ success: true });
    }
    
    return res.status(405).json({ error: '不支持的操作' });
    
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
}