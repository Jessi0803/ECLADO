import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase.js';
import { withProductImagePublicUrl } from '../services/catalogData.js';
import { normalizeMember, normalizeOrder, normalizeProduct } from './domain/mappers.js';
import Sidebar from './components/Sidebar.jsx';
import AIReorder from './pages/AIReorderPage.jsx';
import Analytics from './pages/AnalyticsPage.jsx';
import Catalog from './pages/CatalogPage.jsx';
import Dashboard from './pages/DashboardPage.jsx';
import Members from './pages/MembersPage.jsx';
import Orders from './pages/OrdersPage.jsx';
import Promotions from './pages/PromotionsPage.jsx';
import { INIT_MEMBERS, INIT_ORDERS, INIT_PRODUCTS } from './data/mockData.js';

export default function AdminApp({ adminEmail, onSignOut }) {
  const [page, setPage] = useState('dashboard');
  const [membersDefaultFilter, setMembersDefaultFilter] = useState('all');
  const [products, setProducts] = useState(INIT_PRODUCTS);
  const [members, setMembers] = useState(INIT_MEMBERS);
  const [orders, setOrders] = useState(INIT_ORDERS);
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [applicationsError, setApplicationsError] = useState('');
  const [loadError, setLoadError] = useState('');

  // 從 Supabase 載入訂單 + 會員 + 商品庫存
  async function updateApplicationStatus(id, status) {
    const { error } = await supabase.from('professional_applications').update({ status }).eq('id', id);
    if (error) {
      console.error('update application failed', error);
      return;
    }
    const app = applications.find(a => a.id === id);
    if (app?.user_id) {
      if (status === 'approved') {
        await supabase.from('profiles').update({ role: 'pro' }).eq('id', app.user_id);
      } else if (status === 'rejected') {
        await supabase.from('profiles').update({ role: 'consumer' }).eq('id', app.user_id);
      } else if (status === 'pending') {
        await supabase.from('profiles').update({ role: 'pending' }).eq('id', app.user_id);
      }
    }
    setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    await fetchAll();
  }

  async function fetchAll() {
    setApplicationsLoading(true);
    try {
      const [ordersRes, profilesRes, productsRes, variantsRes, imagesRes, applicationsRes] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('*').order('id', { ascending: true }),
        supabase.from('product_variants').select('*').order('sort_order', { ascending: true }),
        supabase.from('product_images').select('*').order('sort_order', { ascending: true }),
        supabase.from('professional_applications').select('*').order('created_at', { ascending: false }),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const realOrders = (ordersRes.data || []).map(normalizeOrder);
      const ids = new Set(realOrders.map(o => o.id));
      const mockExtras = INIT_ORDERS.filter(o => !ids.has(o.id));
      const allOrders = [...realOrders, ...mockExtras];
      setOrders(allOrders);

      const realMembers = (profilesRes.data || []).map(p => normalizeMember(p, allOrders));
      const apps = applicationsRes.error ? [] : (applicationsRes.data || []);

      // 沒對到 profile 的 pending 申請（user_id null 或 user_id 對不到任何 profile）
      // 包成虛擬會員加入列表，讓後台「待審核申請」tab 看得到
      const profileIds = new Set(realMembers.map(m => m.id));
      const orphanMembers = apps
        .filter(a => a.status === 'pending' && (!a.user_id || !profileIds.has(a.user_id)))
        .map(a => ({
          id: `app:${a.id}`,
          name: a.contact_name || '未登入申請',
          email: a.user_email || '',
          phone: a.phone || '',
          type: 'pending',
          cert: a.certificate || '',
          joined: a.created_at ? a.created_at.slice(0, 10) : '',
          orders: 0,
          total: 0,
        }));
      const allMembers = [...realMembers, ...orphanMembers];
      setMembers(allMembers.length > 0 ? allMembers : INIT_MEMBERS);

      if (!productsRes.error) {
        const variantsByProduct = (variantsRes.error ? [] : (variantsRes.data || [])).reduce((map, variant) => {
          const productId = Number(variant.product_id);
          if (!map.has(productId)) map.set(productId, []);
          map.get(productId).push(variant);
          return map;
        }, new Map());
        const imagesByProduct = (imagesRes.error ? [] : (imagesRes.data || [])).reduce((map, image) => {
          const productId = Number(image.product_id);
          if (!map.has(productId)) map.set(productId, []);
          map.get(productId).push(withProductImagePublicUrl(image));
          return map;
        }, new Map());
        setProducts((productsRes.data || []).map(row => (
          normalizeProduct(
            row,
            variantsRes.error ? null : (variantsByProduct.get(Number(row.id)) || []),
            imagesRes.error ? [] : (imagesByProduct.get(Number(row.id)) || []),
          )
        )));
      }
      if (productsRes.error) {
        setLoadError('商品庫存尚未連接 Supabase products 表，請先執行 supabase-products.sql；目前顯示本機示範庫存。');
      } else if (variantsRes.error) {
        console.error('product variants fetch failed', variantsRes.error);
        setLoadError('無法載入商品規格：' + (variantsRes.error.message || '請確認已執行規格資料表 migration'));
      } else if (imagesRes.error) {
        console.error('product images fetch failed', imagesRes.error);
        setLoadError('無法載入商品圖片：' + (imagesRes.error.message || '請確認已執行圖片資料表 migration'));
      } else {
        setLoadError('');
      }
      if (applicationsRes.error) {
        console.error('applications fetch failed', applicationsRes.error);
        setApplications([]);
        setApplicationsError('無法載入專業申請：' + (applicationsRes.error.message || '請確認已建立 professional_applications 資料表'));
      } else {
        setApplications(apps);
        setApplicationsError('');
      }

    } catch (err) {
      console.error('fetch failed', err);
      setLoadError('無法連接 Supabase（' + (err.message || '') + '），目前顯示本機示範資料。');
      setApplicationsError('無法載入專業申請資料');
    } finally {
      setApplicationsLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_images' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'professional_applications' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // 訂單狀態/托運單號變動時同步到 Supabase
  async function setOrdersWithSync(updater) {
    setOrders(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      next.forEach(o => {
        const old = prev.find(p => p.id === o.id);
        if (old) {
          const update = {};
          if (old.status !== o.status) update.status = o.status;
          if (old.tracking !== o.tracking) update.tracking = o.tracking;
          if (Object.keys(update).length) {
            supabase.from('orders').update(update).eq('id', o.id).then(({ error }) => {
              if (error) console.error('update order failed', error);
            });
          }
        }
      });
      return next;
    });
  }

  async function persistOrderPatch(id, patch) {
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) throw error;
    const localPatch = {
      ...patch,
      ...('shipping_carrier' in patch ? { shippingCarrier: patch.shipping_carrier || '' } : {}),
      ...('shipped_at' in patch ? { shippedAt: patch.shipped_at || null } : {}),
      ...('shipment_notification_sent_at' in patch ? { shipmentNotificationSentAt: patch.shipment_notification_sent_at || null } : {}),
      ...('shipment_notification_channel' in patch ? { shipmentNotificationChannel: patch.shipment_notification_channel || '' } : {}),
      ...('shipment_notification_error' in patch ? { shipmentNotificationError: patch.shipment_notification_error || '' } : {}),
    };
    setOrders(prev => prev.map(order => order.id === id ? { ...order, ...localPatch } : order));
  }

  async function saveProductWithVariants(product) {
    const productPayload = {
      ...(product.id ? { id: product.id } : {}),
      ...(product.assetKey ? { asset_key: product.assetKey } : {}),
      name: product.name || '',
      name_zh: product.nameZh || '',
      category: product.category || '',
      min_stock: Math.max(0, Number(product.minStock) || 0),
      is_pro_only: !!product.isProOnly,
      description: product.desc || '',
      skin_type: product.skinType || '',
      ingredients: product.ingredients || '',
      features: Array.isArray(product.features) ? product.features : [],
      source_folder_name: product.sourceFolderName || null,
      imported_from_drive: !!product.importedFromDrive,
      product_list_image_scale: product.listImageScale || null,
      publication_status: product.publicationStatus || (product.active === false ? 'archived' : 'active'),
    };
    const variantsPayload = (product.variants || []).map((variant, index) => ({
      ...(/^[0-9]+$/.test(String(variant.id || '')) ? { id: String(variant.id) } : {}),
      sku: String(variant.sku || '').trim(),
      size: String(variant.size || '').trim(),
      price: Number(variant.price) || 0,
      pro_price: Number(variant.proPrice) || 0,
      stock: Math.max(0, Number(variant.stock) || 0),
      is_default: !!variant.isDefault,
      sort_order: index,
      active: variant.active !== false,
    }));

    const uploadedPaths = [];
    const preparedImages = [];
    for (const [index, image] of (product.productImages || []).entries()) {
      if (!image.pendingFile) {
        preparedImages.push(image);
        continue;
      }
      const extension = image.pendingFile.type === 'image/png'
        ? 'png'
        : image.pendingFile.type === 'image/webp' ? 'webp' : 'jpg';
      const storagePath = `products/${product.assetKey}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(storagePath, image.pendingFile, {
          cacheControl: '31536000',
          contentType: image.pendingFile.type,
          upsert: false,
        });
      if (uploadError) {
        if (uploadedPaths.length) {
          await supabase.storage.from('product-images').remove(uploadedPaths);
        }
        return `圖片 ${index + 1} 上傳失敗：${uploadError.message || '請稍後再試'}`;
      }
      uploadedPaths.push(storagePath);
      preparedImages.push({
        ...image,
        storagePath,
        originalName: image.pendingFile.name,
        mimeType: image.pendingFile.type,
        fileSize: image.pendingFile.size,
      });
    }

    const { data, error } = await supabase.rpc('save_product_with_variants', {
      p_product: productPayload,
      p_variants: variantsPayload,
    });
    if (error) {
      if (uploadedPaths.length) {
        await supabase.storage.from('product-images').remove(uploadedPaths);
      }
      console.error('save product with variants failed', error);
      return '儲存商品失敗：' + (error.message || '請稍後再試');
    }
    const imagesPayload = preparedImages.map((image, index) => ({
      ...(/^[0-9a-f-]{36}$/i.test(String(image.id || '')) ? { id: image.id } : {}),
      storage_path: image.storagePath,
      original_name: image.originalName || '',
      alt_text: image.altText || product.nameZh || '',
      sort_order: index,
      is_primary: !!image.isPrimary,
      active: image.active !== false,
      mime_type: image.mimeType || null,
      file_size: image.fileSize,
      width: image.width,
      height: image.height,
    }));
    const { error: imagesError } = await supabase.rpc('save_product_images', {
      p_product_id: Number(data?.product_id),
      p_images: imagesPayload,
    });
    if (imagesError) {
      if (uploadedPaths.length) {
        await supabase.storage.from('product-images').remove(uploadedPaths);
      }
      console.error('save product images failed', imagesError);
      return '商品已儲存，但圖片資料儲存失敗：' + (imagesError.message || '請稍後再試');
    }
    await fetchAll();
    return data?.product_id ? '' : '儲存商品失敗：後端回傳格式不完整';
  }

  async function archiveProduct(product) {
    const { error } = await supabase.from('products').update({ publication_status: 'archived' }).eq('id', product.id);
    if (error) {
      return '下架商品失敗：' + (error.message || '請稍後再試');
    }
    setProducts(prev => prev.map(p => p.id === product.id
      ? { ...p, publicationStatus: 'archived', active: false }
      : p));
    return '';
  }

  async function restoreProduct(product) {
    const { error } = await supabase.from('products').update({ publication_status: 'active' }).eq('id', product.id);
    if (error) {
      return '重新上架失敗：' + (error.message || '請稍後再試');
    }
    setProducts(prev => prev.map(p => p.id === product.id
      ? { ...p, publicationStatus: 'active', active: true }
      : p));
    return '';
  }

  // 會員角色變動時同步到 Supabase
  async function setMembersWithSync(updater) {
    setMembers(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      next.forEach(m => {
        const old = prev.find(p => p.id === m.id);
        if (old && old.type !== m.type) {
          // 只有真實 Supabase 會員（id 是 uuid）才更新
          if (typeof m.id === 'string' && m.id.length > 20) {
            supabase.from('profiles').update({ role: m.type }).eq('id', m.id).then(({ error }) => {
              if (error) console.error('update role failed', error);
            });
          }
        }
      });
      return next;
    });
  }

  async function deleteMemberWithSync(member) {
    if (!member?.id) return '找不到會員 ID，無法刪除。';
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return '管理員登入狀態已失效，請重新登入後再試。';

      const response = await fetch('/api/admin-delete-member', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberId: member.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        return '刪除會員失敗：' + (result?.error || '請稍後再試');
      }

      setMembers(prev => prev.filter(m => m.id !== member.id));
      await fetchAll();
      return '';
    } catch (error) {
      console.error('delete member failed', error);
      return '刪除會員失敗：' + (error.message || '請稍後再試');
    }
  }

  function renderPage() {
    const activeProducts = products.filter(product => product.active !== false);
    switch (page) {
      case 'dashboard': return <Dashboard orders={orders} products={activeProducts} members={members} applications={applications} onGoToPendingMembers={() => { setMembersDefaultFilter('app_pending'); setPage('members'); }} />;
      case 'orders': return <Orders orders={orders} setOrders={setOrdersWithSync} persistOrderPatch={persistOrderPatch} />;
      case 'catalog': return <Catalog products={products} onSaveProduct={saveProductWithVariants} onArchiveProduct={archiveProduct} onRestoreProduct={restoreProduct} />;
      // 舊路徑相容，避免有人記住 /admin#products 之類的
      case 'products':
      case 'inventory': return <Catalog products={products} onSaveProduct={saveProductWithVariants} onArchiveProduct={archiveProduct} onRestoreProduct={restoreProduct} />;
      case 'promotions': return <Promotions products={activeProducts} />;
      case 'members': return <Members members={members} setMembers={setMembersWithSync} orders={orders} applications={applications} applicationsLoading={applicationsLoading} applicationsError={applicationsError} onUpdateApplicationStatus={updateApplicationStatus} onDeleteMember={deleteMemberWithSync} defaultFilter={membersDefaultFilter} />;
      case 'applications': return <Members members={members} setMembers={setMembersWithSync} orders={orders} applications={applications} applicationsLoading={applicationsLoading} applicationsError={applicationsError} onUpdateApplicationStatus={updateApplicationStatus} onDeleteMember={deleteMemberWithSync} defaultFilter="app_pending" />;
      case 'analytics': return <Analytics />;
      case 'ai': return <AIReorder products={activeProducts} />;
      default: return <Dashboard orders={orders} products={activeProducts} members={members} applications={applications} onGoToPendingMembers={() => { setMembersDefaultFilter('app_pending'); setPage('members'); }} />;
    }
  }

  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-shell">
      {/* 手機頂部 bar */}
      <div className="mobile-topbar">
        <button onClick={() => setDrawerOpen(true)} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 8,
          display: 'flex', flexDirection: 'column', gap: 4,
        }} aria-label="開啟選單">
          <span style={{ display: 'block', width: 22, height: 1.5, background: '#fff' }} />
          <span style={{ display: 'block', width: 16, height: 1.5, background: '#fff' }} />
          <span style={{ display: 'block', width: 22, height: 1.5, background: '#fff' }} />
        </button>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 14, letterSpacing: '0.2em', color: '#fff' }}>ECLADO</div>
        <div style={{ width: 38 }} />
      </div>

      {/* 手機抽屜遮罩 */}
      {drawerOpen && <div className="mobile-overlay" onClick={() => setDrawerOpen(false)} />}

      <Sidebar page={page} setPage={setPage} open={drawerOpen} onClose={() => setDrawerOpen(false)} adminEmail={adminEmail} onSignOut={onSignOut} />
      <main className="app-main">
        {loadError && (
          <div style={{ background: 'oklch(0.60 0.18 25 / 0.08)', border: '1px solid oklch(0.60 0.18 25 / 0.3)', padding: '10px 16px', marginBottom: 20, fontSize: 12, color: 'var(--red)' }}>
            ⚠ {loadError}
          </div>
        )}
        {renderPage()}
      </main>
    </div>
  );
}
