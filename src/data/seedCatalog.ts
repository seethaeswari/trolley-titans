import { Product, Trolley } from '../types/store';

export const HERO_IMAGE_PATH = '/src/assets/images/hero_smart_trolley_1794929151868.jpg';

export const SAMPLE_PRODUCTS: Omit<Product, 'updatedAt'>[] = [
  {
    productId: 'PROD001',
    name: 'Basmati Rice',
    qrCode: 'TT-PROD-RICE-001',
    price: 320,
    gstRate: 5,
    available: true,
    category: 'Grains & Staples',
    unit: '5 kg Bag',
    imagePath: '/src/assets/images/product_basmati_rice_1794929152376.jpg',
  },
  {
    productId: 'PROD002',
    name: 'Fresh Milk',
    qrCode: 'TT-PROD-MILK-002',
    price: 64,
    gstRate: 0,
    available: true,
    category: 'Dairy & Fresh',
    unit: '1 Litre Carton',
    imagePath: '/src/assets/images/product_fresh_milk_1794929152217.jpg',
  },
  {
    productId: 'PROD003',
    name: 'Butter Biscuit',
    qrCode: 'TT-PROD-BISCUIT-003',
    price: 45,
    gstRate: 18,
    available: true,
    category: 'Bakery & Snacks',
    unit: '250 g Pack',
    imagePath: '/src/assets/images/product_butter_biscuits_1794929153786.jpg',
  },
  {
    productId: 'PROD004',
    name: 'Herbal Soap',
    qrCode: 'TT-PROD-SOAP-004',
    price: 52,
    gstRate: 18,
    available: true,
    category: 'Personal Care',
    unit: '125 g Bar',
    imagePath: '/src/assets/images/product_herbal_soap_1794929153088.jpg',
  },
  {
    productId: 'PROD005',
    name: 'Shine Shampoo',
    qrCode: 'TT-PROD-SHAMPOO-005',
    price: 210,
    gstRate: 18,
    available: true,
    category: 'Personal Care',
    unit: '340 ml Bottle',
    imagePath: '/src/assets/images/product_shine_shampoo_1794929153654.jpg',
  },
  {
    productId: 'PROD006',
    name: 'Cooking Oil',
    qrCode: 'TT-PROD-OIL-006',
    price: 185,
    gstRate: 5,
    available: true,
    category: 'Oils & Pantry',
    unit: '1 Litre Bottle',
    imagePath: '/src/assets/images/product_cooking_oil_1794929154270.jpg',
  },
];

export const SAMPLE_TROLLEYS: Omit<Trolley, 'updatedAt'>[] = [
  {
    trolleyId: 'T001',
    label: 'Express Trolley 01',
    status: 'AVAILABLE',
    activeSessionId: null,
    activeCustomerId: null,
  },
  {
    trolleyId: 'T002',
    label: 'Express Trolley 02',
    status: 'AVAILABLE',
    activeSessionId: null,
    activeCustomerId: null,
  },
  {
    trolleyId: 'T003',
    label: 'Family Smart Trolley 03',
    status: 'AVAILABLE',
    activeSessionId: null,
    activeCustomerId: null,
  },
];

export const BOOTSTRAPPED_ADMIN_EMAIL = 'seetha.easwari@bhumi.ngo';
