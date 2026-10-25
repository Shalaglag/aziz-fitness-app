// Response shapes as returned by https://world.openfoodfacts.org/api/v2/product/{code}.json
module.exports = {
  full: { code: "5449000000996", status: 1, status_verbose: "product found", product: {
    product_name: "Coca-Cola", brands: "Coca-Cola, The Coca-Cola Company", quantity: "330 ml",
    serving_size: "330 ml", serving_quantity: 330,
    nutriments: { "energy-kcal_100g": 42, "energy-kj_100g": 180, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 } } },
  kjOnly: { code: "6281007031233", status: 1, product: {
    product_name: "Labneh", brands: "Almarai", serving_size: "30 g",
    nutriments: { energy_100g: 836, energy_unit: "kJ", proteins_100g: "6,5", carbohydrates_100g: 4, fat_100g: 17 } } },
  missingFat: { code: "4006381333931", status: 1, product: {
    product_name_en: "Protein bar", product_name: "Proteinriegel", brands: "Brand",
    nutriments: { "energy-kcal_100g": 360, proteins_100g: 33, carbohydrates_100g: 30 } } },
  notFound: { code: "6281007031233", status: 0, status_verbose: "product not found" },
};
