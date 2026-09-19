export type StockMovement = Readonly<{ productId: string; quantity: number; direction: "in" | "out"; referenceId: string }>;
export class StockMovementError extends Error { constructor(message: string) { super(message); this.name = "StockMovementError"; } }
/** Applies a deterministic stock delta; negative closing stock is rejected in the synthetic contract. */
export function applyStockMovement(currentQuantity: number, movement: StockMovement): number {
  if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || !Number.isSafeInteger(movement.quantity) || movement.quantity <= 0) throw new StockMovementError("stock quantities must be positive safe integers");
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(movement.productId) || !/^[a-z][a-z0-9_-]{2,99}$/i.test(movement.referenceId)) throw new StockMovementError("stock identifiers are invalid");
  const next = movement.direction === "in" ? currentQuantity + movement.quantity : currentQuantity - movement.quantity;
  if (next < 0) throw new StockMovementError("stock movement would make quantity negative");
  return next;
}
