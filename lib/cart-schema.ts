import { z } from "zod";

/** 키오스크가 보내는 장바구니 (주문 생성·고객 조회에서 함께 사용) */
export const CartItemsBody = z
  .array(
    z.object({
      menuItemId: z.number().int().positive(),
      quantity: z.number().int().min(1).max(20),
      optionItemIds: z.array(z.number().int().positive()).max(20),
    }),
  )
  .min(1)
  .max(30);
