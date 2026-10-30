import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next";

import { apl } from "@/lib/apl";

export default createAppRegisterHandler({ apl });
