# Use Nginx image
FROM nginx:alpine

# Copy build folder into Nginx html folder
COPY build/ /usr/share/nginx/html/

# Expose port 3000
EXPOSE 3000

# Start Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
