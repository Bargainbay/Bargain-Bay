'use client';
import { useEffect, useState } from 'react';
import { addToCart, inCart, onCartChange } from '../lib/cart';

// Adds every unit of a package to the cart at once. The package price is not
// stored here: checkout works it out from the cart, so it applies whether the
// shopper arrives by this button or adds the same units one at a time.
export default function AddBundleButton({ skus }) {
  const [all, setAll] = useState(false);
  useEffect(() => {
    const check = () => setAll(skus.every(inCart));
    check();
    return onCartChange(check);
  }, [skus]);
  if (all) return <a href="/cart" className="btn block">✓ Package in cart — view</a>;
  return <button className="btn accent block" onClick={() => { skus.forEach(addToCart); setAll(true); }}>Add the package to cart</button>;
}
