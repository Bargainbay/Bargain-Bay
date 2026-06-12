'use client';
import { useEffect, useState } from 'react';
import { addToCart, inCart, onCartChange } from '../lib/cart';

export default function AddToCartButton({ sku, available = true, small = false }) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setAdded(inCart(sku));
    return onCartChange(() => setAdded(inCart(sku)));
  }, [sku]);

  if (!available) {
    return <button className={'btn' + (small ? '' : ' block')} disabled>Sold</button>;
  }
  if (added) {
    return (
      <a href="/cart" className={'btn' + (small ? '' : ' block')}>✓ In cart — view</a>
    );
  }
  return (
    <button
      className={'btn accent' + (small ? '' : ' block')}
      onClick={() => { addToCart(sku); setAdded(true); }}
    >
      Add to cart
    </button>
  );
}
