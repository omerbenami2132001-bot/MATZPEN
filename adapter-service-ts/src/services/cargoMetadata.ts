// CargoMetadata — מעבד metadata מ-child data שכבר בזיכרון (בלי HTTP).
import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { METADATA_API_1_PREFIX } from "../utils/constants";
import { CargoChildSchema } from "../schemas";

export class CargoMetadata {
  processCargo(childData: Record<string, unknown>, requestId: string) {
    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "Processing cargo metadata", {
      prefix: METADATA_API_1_PREFIX, fieldCount: Object.keys(childData).length,
    });

    const result = metadataPipeline(childData, METADATA_API_1_PREFIX, CargoChildSchema);

    // isFolder needed for Schema validation but not for S3/Kafka output
    delete result[`${METADATA_API_1_PREFIX}_isfolder`];

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "Cargo metadata ready", {
      prefix: METADATA_API_1_PREFIX, fieldCount: Object.keys(result).length,
    });

    return result;
  }
}
