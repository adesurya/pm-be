// services/uploadService.js
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const logger = require('../utils/logger');

class UploadService {
  constructor() {
    this.baseUploadPath = process.env.UPLOAD_PATH || path.join(process.cwd(), 'public', 'uploads');
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.allowedMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff'
    ];
    
    this.imageQuality = {
      webp: 90, // High quality WebP
      jpeg: 90,
      png: 9 // compression level 0-9
    };

    this.imageSizes = {
      thumbnail: { width: 150, height: 150, quality: 85 },
      small: { width: 400, height: 300, quality: 90 },
      medium: { width: 800, height: 600, quality: 90 },
      large: { width: 1200, height: 900, quality: 90 },
      xl: { width: 1920, height: 1440, quality: 85 }
    };

    this.ensureDirectoriesExist();
  }

  async ensureDirectoriesExist() {
    try {
      await fs.access(this.baseUploadPath);
    } catch {
      await fs.mkdir(this.baseUploadPath, { recursive: true });
      logger.info(`Created upload directory: ${this.baseUploadPath}`);
    }
  }

  // Get tenant-specific upload path
  getTenantUploadPath(tenantId) {
    return path.join(this.baseUploadPath, 'tenants', tenantId);
  }

  // Ensure tenant upload directory exists
  async ensureTenantDirectory(tenantId) {
    const tenantPath = this.getTenantUploadPath(tenantId);
    
    try {
      await fs.access(tenantPath);
    } catch {
      await fs.mkdir(tenantPath, { recursive: true });
      
      // Create subdirectories
      const subdirs = ['articles', 'avatars', 'categories', 'temp', 'logos'];
      for (const subdir of subdirs) {
        await fs.mkdir(path.join(tenantPath, subdir), { recursive: true });
      }
      
      logger.info(`Created tenant upload directories for: ${tenantId}`);
    }
    
    return tenantPath;
  }

  // Validate file security
  async validateFile(buffer, mimetype) {
    try {
      // Check if the buffer is valid
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty file buffer');
      }

      // Check file signature/magic numbers for security
      const fileSignatures = {
        'image/jpeg': [0xFF, 0xD8, 0xFF],
        'image/png': [0x89, 0x50, 0x4E, 0x47],
        'image/gif': [0x47, 0x49, 0x46],
        'image/webp': [0x52, 0x49, 0x46, 0x46],
        'image/bmp': [0x42, 0x4D]
      };

      const signature = fileSignatures[mimetype];
      if (signature) {
        const fileHeader = Array.from(buffer.slice(0, signature.length));
        const matches = signature.every((byte, index) => fileHeader[index] === byte);
        
        if (!matches) {
          throw new Error('File signature does not match declared type');
        }
      }

      // Additional validation with Sharp
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image dimensions');
      }

      return true;
    } catch (error) {
      throw new Error(`File validation failed: ${error.message}`);
    }
  }

  // Configure multer for file upload
  getMulterConfig(tenantId, uploadType = 'articles') {
    const storage = multer.memoryStorage(); // Store in memory for processing

    const fileFilter = (req, file, cb) => {
      try {
        // Check mime type
        if (!this.allowedMimeTypes.includes(file.mimetype)) {
          return cb(new Error(`Invalid file type. Allowed: ${this.allowedMimeTypes.join(', ')}`));
        }

        // Check file extension
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        if (!allowedExtensions.includes(ext)) {
          return cb(new Error('Invalid file extension'));
        }

        cb(null, true);
      } catch (error) {
        cb(error);
      }
    };

    return multer({
      storage,
      fileFilter,
      limits: {
        fileSize: this.maxFileSize,
        files: 10 // Max 10 files per request
      }
    });
  }

  // Process and save image with high-quality WebP conversion
  async processAndSaveImage(buffer, tenantId, uploadType = 'articles', generateSizes = true, options = {}) {
    try {
      // Validate file
      await this.validateFile(buffer, 'image/*');
      
      await this.ensureTenantDirectory(tenantId);
      
      const imageId = uuidv4();
      const tenantPath = this.getTenantUploadPath(tenantId);
      const typePath = path.join(tenantPath, uploadType);
      
      // Ensure type directory exists
      await fs.mkdir(typePath, { recursive: true });
      
      // Get image metadata
      const metadata = await sharp(buffer).metadata();
      logger.info(`Processing image: ${metadata.width}x${metadata.height}, format: ${metadata.format}, size: ${buffer.length} bytes`);

      const processedImages = {};
      const originalSize = buffer.length;
      let totalCompressedSize = 0;
      
      if (generateSizes) {
        // Generate multiple sizes with optimized WebP
        for (const [sizeName, dimensions] of Object.entries(this.imageSizes)) {
          const shouldResize = metadata.width > dimensions.width || metadata.height > dimensions.height;
          
          let sharpInstance = sharp(buffer);
          
          if (shouldResize) {
            sharpInstance = sharpInstance.resize(dimensions.width, dimensions.height, {
              fit: 'inside',
              withoutEnlargement: true,
              kernel: sharp.kernel.lanczos3 // High quality resampling
            });
          }

          // Convert to WebP with optimized settings
          const processedBuffer = await sharpInstance
            .webp({ 
              quality: dimensions.quality || this.imageQuality.webp,
              effort: 6, // Better compression (0-6)
              smartSubsample: true,
              preset: 'photo',
              nearLossless: false
            })
            .toBuffer();

          const filename = `${imageId}_${sizeName}.webp`;
          const filepath = path.join(typePath, filename);
          
          await fs.writeFile(filepath, processedBuffer);
          
          const fileStats = await fs.stat(filepath);
          const finalMetadata = await sharp(processedBuffer).metadata();
          
          processedImages[sizeName] = {
            filename,
            path: `/uploads/tenants/${tenantId}/${uploadType}/${filename}`,
            size: fileStats.size,
            width: finalMetadata.width,
            height: finalMetadata.height,
            format: 'webp'
          };

          totalCompressedSize += fileStats.size;
        }
      } else {
        // Single image processing with original dimensions
        const processedBuffer = await sharp(buffer)
          .webp({ 
            quality: options.quality || this.imageQuality.webp,
            effort: 6,
            smartSubsample: true,
            preset: 'photo'
          })
          .toBuffer();

        const filename = `${imageId}.webp`;
        const filepath = path.join(typePath, filename);
        
        await fs.writeFile(filepath, processedBuffer);
        
        const fileStats = await fs.stat(filepath);
        const finalMetadata = await sharp(processedBuffer).metadata();
        
        processedImages.original = {
          filename,
          path: `/uploads/tenants/${tenantId}/${uploadType}/${filename}`,
          size: fileStats.size,
          width: finalMetadata.width,
          height: finalMetadata.height,
          format: 'webp'
        };

        totalCompressedSize = fileStats.size;
      }

      const compressionRatio = ((originalSize - totalCompressedSize) / originalSize * 100).toFixed(2);
      
      logger.info(`Image processed successfully: ${imageId}, compression: ${compressionRatio}%`);
      
      return {
        id: imageId,
        images: processedImages,
        metadata: {
          original_size: originalSize,
          compressed_size: totalCompressedSize,
          compression_ratio: parseFloat(compressionRatio),
          original_format: metadata.format,
          final_format: 'webp',
          original_dimensions: {
            width: metadata.width,
            height: metadata.height
          }
        },
        upload_type: uploadType,
        tenant_id: tenantId,
        created_at: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Image processing error:', error);
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }

  // Process multiple images
  async processMultipleImages(files, tenantId, uploadType = 'articles') {
    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const result = await this.processAndSaveImage(
          files[i].buffer,
          tenantId,
          uploadType,
          true
        );
        results.push({
          index: i,
          success: true,
          data: result
        });
      } catch (error) {
        errors.push({
          index: i,
          success: false,
          error: error.message
        });
      }
    }

    return { results, errors };
  }

  // Delete image files
  async deleteImage(tenantId, imageId, uploadType = 'articles') {
    try {
      const tenantPath = this.getTenantUploadPath(tenantId);
      const typePath = path.join(tenantPath, uploadType);
      
      // Get all files with this imageId
      const files = await fs.readdir(typePath);
      const imageFiles = files.filter(file => file.startsWith(imageId));
      
      let deletedCount = 0;
      for (const file of imageFiles) {
        const filepath = path.join(typePath, file);
        try {
          await fs.unlink(filepath);
          deletedCount++;
        } catch (error) {
          logger.warn(`Failed to delete file: ${filepath}`, error);
        }
      }
      
      logger.info(`Deleted ${deletedCount} image files for: ${imageId}`);
      return deletedCount > 0;
    } catch (error) {
      logger.error('Image deletion error:', error);
      return false;
    }
  }

  // Get image URL helper
  getImageUrl(tenantId, uploadType, filename, baseUrl = null) {
    const domain = baseUrl || process.env.CDN_URL || process.env.BASE_URL || 'http://localhost:3000';
    return `${domain}/uploads/tenants/${tenantId}/${uploadType}/${filename}`;
  }

  // Get all image URLs for a processed image
  getImageUrls(tenantId, uploadType, imageData, baseUrl = null) {
    if (!imageData || !imageData.images) return null;

    const urls = {};
    for (const [size, img] of Object.entries(imageData.images)) {
      urls[size] = this.getImageUrl(tenantId, uploadType, img.filename, baseUrl);
    }
    return urls;
  }

  // Clean up temporary files
  async cleanupTempFiles(tenantId, olderThan = 24 * 60 * 60 * 1000) { // 24 hours
    try {
      const tempPath = path.join(this.getTenantUploadPath(tenantId), 'temp');
      
      try {
        await fs.access(tempPath);
      } catch {
        return 0; // Directory doesn't exist
      }

      const files = await fs.readdir(tempPath);
      const now = Date.now();
      
      let deletedCount = 0;
      for (const file of files) {
        const filepath = path.join(tempPath, file);
        const stats = await fs.stat(filepath);
        
        if (now - stats.ctimeMs > olderThan) {
          await fs.unlink(filepath);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} temporary files for tenant: ${tenantId}`);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('Temp file cleanup error:', error);
      return 0;
    }
  }

  // Get storage usage for tenant
  async getTenantStorageUsage(tenantId) {
    try {
      const tenantPath = this.getTenantUploadPath(tenantId);
      
      const calculateDirSize = async (dirPath) => {
        let totalSize = 0;
        try {
          const files = await fs.readdir(dirPath, { withFileTypes: true });
          
          for (const file of files) {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
              totalSize += await calculateDirSize(filePath);
            } else {
              const stats = await fs.stat(filePath);
              totalSize += stats.size;
            }
          }
        } catch (error) {
          // Directory might not exist
        }
        return totalSize;
      };

      const totalSize = await calculateDirSize(tenantPath);
      
      return {
        total_size: totalSize,
        formatted_size: this.formatBytes(totalSize),
        tenant_id: tenantId,
        checked_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Storage usage calculation error:', error);
      return {
        total_size: 0,
        formatted_size: '0 B',
        tenant_id: tenantId,
        error: error.message
      };
    }
  }

  // Format bytes to human readable
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Image optimization settings
  getOptimizationSettings(imageType = 'photo') {
    const settings = {
      photo: {
        webp: { quality: 90, effort: 6, smartSubsample: true },
        jpeg: { quality: 90, mozjpeg: true },
        png: { quality: 90, compressionLevel: 9 }
      },
      illustration: {
        webp: { quality: 95, effort: 6, smartSubsample: false },
        jpeg: { quality: 95, mozjpeg: true },
        png: { quality: 95, compressionLevel: 9 }
      },
      logo: {
        webp: { quality: 100, effort: 6, lossless: true },
        png: { quality: 100, compressionLevel: 9 }
      }
    };

    return settings[imageType] || settings.photo;
  }
}

module.exports = new UploadService();