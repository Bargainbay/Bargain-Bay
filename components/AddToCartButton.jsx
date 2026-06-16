'use client';
import { useEffect, useState } from 'react';
import { addToCart, inCart, onCartChange } from '../lib/cart';
import { addToCart as addToCartPixel } from '../lib/fpixel';

export default function AddToCartButton({ sku, available = true, small = false, price, name }) {
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
      onClick={() => {
        addToCart(sku);
        addToCartPixel({ id: sku, name, value: price });
        setAdded(true);
      }}
    >
      Add to cart
    </button>
  );
}
