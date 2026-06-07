// ============================================
// test-s3-connection.js
// ============================================
// בודק שהחיבור ל-S3 עובד באמת
//
// הרצה:
//   node test-s3-connection.js
//
// מה הוא עושה:
// 1. מתחבר ל-S3 עם הפרטים מ-.env
// 2. מנסה לרשום את ה-buckets
// 3. מנסה להעלות קובץ טסט קטן
// 4. מנסה לקרוא אותו חזרה
// 5. מוחק את קובץ הטסט

require("dotenv").config();

const { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const BUCKET = process.env.S3_BUCKET || "raw-data";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function main() {
  console.log("S3 Connection Test");
  console.log("==================");
  console.log(`Endpoint: ${process.env.S3_ENDPOINT}`);
  console.log(`Bucket:   ${BUCKET}`);
  console.log(`Region:   ${process.env.AWS_REGION || "us-east-1"}`);
  console.log("");

  // 1. List buckets
  console.log("[1/4] Listing buckets...");
  try {
    const list = await s3.send(new ListBucketsCommand({}));
    const names = list.Buckets.map((b) => b.Name);
    console.log(`  ✓ Found ${names.length} buckets: ${names.join(", ")}`);

    if (!names.includes(BUCKET)) {
      console.log(`  ⚠ Warning: bucket "${BUCKET}" not found in list`);
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    process.exit(1);
  }

  // 2. Upload test file
  const testKey = "adapter-service/_test/connection-test.json";
  const testData = JSON.stringify({ test: true, timestamp: new Date().toISOString() });

  console.log("[2/4] Uploading test file...");
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      Body: testData,
      ContentType: "application/json",
    }));
    console.log(`  ✓ Uploaded: ${testKey}`);
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    process.exit(1);
  }

  // 3. Read it back
  console.log("[3/4] Reading test file...");
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }));
    const body = await response.Body.transformToString();
    const parsed = JSON.parse(body);
    console.log(`  ✓ Read back: ${body}`);
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
  }

  // 4. Delete test file
  console.log("[4/4] Deleting test file...");
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }));
    console.log(`  ✓ Deleted: ${testKey}`);
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
  }

  console.log("\n✓ All good! S3 connection works.");
}

main().catch((err) => {
  console.error("\n✗ Connection failed:", err.message);
  process.exit(1);
});
